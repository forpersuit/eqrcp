package server

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"eqrcp/qr"

	"eqrcp/body"
	"eqrcp/config"
	"eqrcp/pages"
	"eqrcp/util"
	"gopkg.in/cheggaaa/pb.v1"
)

const maxUploadBytes int64 = 10 << 30
const defaultStatusGracePeriod = 15 * time.Second

// Server is the server
type Server struct {
	BaseURL string
	// SendURL is the URL used to send the file
	SendURL string
	// ReceiveURL is the URL used to Receive the file
	ReceiveURL  string
	instance    *http.Server
	mux         *http.ServeMux
	body        body.Body
	outputDir   string
	stopChannel chan bool
	statusMu    sync.Mutex
	status      transferStatus
	statusGrace time.Duration
	// expectParallelRequests is set to true when eqrcp sends files, in order
	// to support downloading of parallel chunks
	expectParallelRequests bool
}

type transferStatus struct {
	State   string `json:"state"`
	Message string `json:"message"`
}

// ReceiveTo sets the output directory
func (s *Server) ReceiveTo(dir string) error {
	output, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	// Check if the output dir exists
	fileinfo, err := os.Stat(output)
	if err != nil {
		return err
	}
	if !fileinfo.IsDir() {
		return fmt.Errorf("%s is not a valid directory", output)
	}
	s.outputDir = output
	return nil
}

// Send adds a handler for sending the file
func (s *Server) Send(p body.Body) {
	s.body = p
	s.expectParallelRequests = true
}

// DisplayQR creates a handler for serving the QR code in the browser
func (s *Server) DisplayQR(url string) error {
	s.SetStatusGracePeriod(defaultStatusGracePeriod)
	const (
		pagePath   = "/qr"
		imagePath  = "/qr/image"
		statusPath = "/qr/status"
		stopPath   = "/qr/stop"
	)
	qrImg, err := qr.RenderImage(url)
	if err != nil {
		return err
	}
	s.mux.HandleFunc(imagePath, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		if err := jpeg.Encode(w, qrImg, nil); err != nil {
			log.Println(err)
		}
	})
	s.mux.HandleFunc(statusPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(s.getStatus()); err != nil {
			log.Println(err)
		}
	})
	s.mux.HandleFunc(stopPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		s.setStatus("stopped", "Transfer stopped.")
		fmt.Fprintln(w, "Transfer stopped. You can close this page.")
		s.signalStop()
	})
	s.mux.HandleFunc(pagePath, func(w http.ResponseWriter, r *http.Request) {
		htmlVariables := struct {
			URL          string
			QRImageRoute string
			StatusRoute  string
			StopRoute    string
		}{
			URL:          url,
			QRImageRoute: imagePath,
			StatusRoute:  statusPath,
			StopRoute:    stopPath,
		}
		if err := serveTemplate("qr", pages.QR, w, htmlVariables); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			log.Printf("Template error: %v\n", err)
			s.signalStop()
			return
		}
	})
	return openBrowser(s.BaseURL + pagePath)
}

func (s *Server) SetStatusGracePeriod(duration time.Duration) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	s.statusGrace = duration
}

func (s *Server) setStatus(state string, message string) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	s.status = transferStatus{State: state, Message: message}
}

func (s *Server) getStatus() transferStatus {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	return s.status
}

func (s *Server) signalStopAfterStatusGrace() {
	s.statusMu.Lock()
	delay := s.statusGrace
	state := s.status.State
	s.statusMu.Unlock()
	if delay > 0 && state == "completed" {
		time.Sleep(delay)
	}
	s.signalStop()
}

// Wait for transfer to be completed, it waits forever if kept awlive
func (s Server) Wait() error {
	<-s.stopChannel
	if err := s.instance.Shutdown(context.Background()); err != nil {
		log.Println(err)
	}
	if s.body.DeleteAfterTransfer {
		if err := s.body.Delete(); err != nil {
			return err
		}
	}
	return nil
}

// Shutdown the server
func (s Server) Shutdown() {
	s.signalStop()
}

func (s Server) signalStop() {
	select {
	case s.stopChannel <- true:
	default:
	}
}

// New instance of the server
func New(cfg *config.Config) (*Server, error) {

	app := &Server{}
	// Get the address of the configured interface to bind the server to.
	// If `bind` configuration parameter has been configured, it takes precedence
	bind, err := util.GetInterfaceAddress(cfg.Interface)
	if err != nil {
		return &Server{}, err
	}
	if cfg.Bind != "" {
		bind = cfg.Bind
	}
	// Create a listener. If `port: 0`, a random one is chosen
	listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", bind, cfg.Port))
	if err != nil {
		return nil, err
	}
	// Set the value of computed port
	port := listener.Addr().(*net.TCPAddr).Port
	// Set the host
	host := fmt.Sprintf("%s:%d", bind, port)
	// Get a random path to use
	path := cfg.Path
	if path == "" {
		path, err = util.GetRandomURLPath()
		if err != nil {
			return nil, err
		}
	}
	// Set the hostname
	hostname := fmt.Sprintf("%s:%d", bind, port)
	// Use external IP when using `interface: any`, unless a FQDN is set
	if bind == "0.0.0.0" && cfg.FQDN == "" {
		fmt.Println("Retrieving the external IP...")
		extIP, err := util.GetExternalIP()
		if err != nil {
			return nil, err
		}
		extIPString := extIP.String()
		fmtstring := "%s:%d"
		if strings.Count(extIPString, ":") >= 2 {
			// IPv6 address, wrap it in [] to add a port
			fmtstring = "[%s]:%d"
		}
		hostname = fmt.Sprintf(fmtstring, extIPString, port)
	}
	// Use a fully-qualified domain name if set
	if cfg.FQDN != "" {
		hostname = fmt.Sprintf("%s:%d", cfg.FQDN, port)
	}
	// Set URLs
	protocol := "http"
	if cfg.Secure {
		protocol = "https"
	}
	app.BaseURL = fmt.Sprintf("%s://%s", protocol, hostname)
	app.SendURL = fmt.Sprintf("%s/send/%s",
		app.BaseURL, path)
	app.ReceiveURL = fmt.Sprintf("%s/receive/%s",
		app.BaseURL, path)
	// Create a server
	mux := http.NewServeMux()
	app.mux = mux
	httpserver := &http.Server{
		Addr:              host,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       2 * time.Minute,
		TLSConfig: &tls.Config{
			MinVersion:               tls.VersionTLS12,
			CurvePreferences:         []tls.CurveID{tls.CurveP521, tls.CurveP384, tls.CurveP256},
			PreferServerCipherSuites: true,
			CipherSuites: []uint16{
				tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA,
				tls.TLS_RSA_WITH_AES_256_GCM_SHA384,
				tls.TLS_RSA_WITH_AES_256_CBC_SHA,
			},
		},
		TLSNextProto: make(map[string]func(*http.Server, *tls.Conn, http.Handler)),
	}
	// Create channel to send message to stop server
	app.stopChannel = make(chan bool, 1)
	app.setStatus("waiting", "Waiting for a device to connect.")
	// Create cookie used to verify request is coming from first client to connect
	cookie := http.Cookie{Name: "eqrcp", Value: ""}
	// Gracefully shutdown when an OS signal is received or when "q" is pressed
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	go func() {
		<-sig
		app.signalStop()
	}()
	// The handler adds and removes from the sync.WaitGroup
	// When the group is zero all requests are completed
	// and the server is shutdown
	var waitgroup sync.WaitGroup
	waitgroup.Add(1)
	var initCookie sync.Once
	// Create handlers
	// Send handler (sends file to caller)
	mux.HandleFunc("/send/"+path, func(w http.ResponseWriter, r *http.Request) {
		app.setStatus("transferring", "Sending file to connected device.")
		if !cfg.KeepAlive && strings.HasPrefix(r.Header.Get("User-Agent"), "Mozilla") {
			if cookie.Value == "" {
				initCookie.Do(func() {
					value, err := util.GetSessionID()
					if err != nil {
						log.Println("Unable to generate session ID", err)
						app.signalStop()
						return
					}
					cookie.Value = value
					http.SetCookie(w, &cookie)
				})
			} else {
				// Check for the expected cookie and value
				// If it is missing or doesn't match
				// return a 400 status
				rcookie, err := r.Cookie(cookie.Name)
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				if rcookie.Value != cookie.Value {
					http.Error(w, "mismatching cookie", http.StatusBadRequest)
					return
				}
				// If the cookie exits and matches
				// this is an aadditional request.
				// Increment the waitgroup
				waitgroup.Add(1)
			}
			// Remove connection from the waitgroup when done
			defer waitgroup.Done()
		}
		w.Header().Set("Content-Disposition", contentDisposition(app.body.Filename))
		http.ServeFile(w, r, app.body.Path)
		app.setStatus("completed", "Transfer completed.")
	})
	// Upload handler (serves the upload page)
	mux.HandleFunc("/receive/"+path, func(w http.ResponseWriter, r *http.Request) {
		htmlVariables := struct {
			Route string
			File  string
		}{}
		htmlVariables.Route = "/receive/" + path
		switch r.Method {
		case "POST":
			app.setStatus("transferring", "Receiving files from connected device.")
			filenames, err := util.ReadFilenames(app.outputDir)
			if err != nil {
				fmt.Fprintf(w, "Unable to read output directory: %v\n", err)
				log.Printf("Unable to read output directory: %v\n", err)
				app.signalStop()
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
			reader, err := r.MultipartReader()
			if err != nil {
				fmt.Fprintf(w, "Upload error: %v\n", err)
				log.Printf("Upload error: %v\n", err)
				app.signalStop()
				return
			}
			transferredFiles := []string{}
			progressBar := pb.New64(r.ContentLength)
			progressBar.ShowCounters = false
			for {
				part, err := reader.NextPart()
				if err == io.EOF {
					break
				}
				// If part.FileName() is empty, skip this iteration.
				if part.FileName() == "" {
					continue
				}
				// Prepare the destination
				out, fileName, err := createUniqueFile(app.outputDir, filepath.Base(part.FileName()), filenames)
				if err != nil {
					// Output to server
					fmt.Fprintf(w, "Unable to create the file for writing: %s\n", err)
					// Output to console
					log.Printf("Unable to create the file for writing: %s\n", err)
					// Send signal to server to shutdown
					app.signalStop()
					return
				}
				// Add name of new file
				filenames = append(filenames, fileName)
				// Write the content from POSTed file to the out
				fmt.Println("Transferring file: ", out.Name())
				progressBar.Prefix(out.Name())
				progressBar.Start()
				buf := make([]byte, 32*1024)
				for {
					// Read a chunk
					n, err := part.Read(buf)
					if err != nil && err != io.EOF {
						// Output to server
						status := http.StatusInternalServerError
						var maxBytesErr *http.MaxBytesError
						if errors.As(err, &maxBytesErr) {
							status = http.StatusRequestEntityTooLarge
						}
						http.Error(w, fmt.Sprintf("Unable to write file to disk: %v", err), status)
						// Output to console
						fmt.Printf("Unable to write file to disk: %v", err)
						out.Close()
						// Send signal to server to shutdown
						app.signalStop()
						return
					}
					if n == 0 {
						break
					}
					// Write a chunk
					if _, err := out.Write(buf[:n]); err != nil {
						// Output to server
						fmt.Fprintf(w, "Unable to write file to disk: %v", err)
						// Output to console
						log.Printf("Unable to write file to disk: %v", err)
						out.Close()
						// Send signal to server to shutdown
						app.signalStop()
						return
					}
					progressBar.Add(n)
				}
				if err := out.Close(); err != nil {
					fmt.Fprintf(w, "Unable to close file: %v", err)
					log.Printf("Unable to close file: %v", err)
					app.signalStop()
					return
				}
				transferredFiles = append(transferredFiles, out.Name())
			}
			progressBar.FinishPrint("File transfer completed")
			// Set the value of the variable to the actually transferred files
			htmlVariables.File = strings.Join(transferredFiles, ", ")
			if err := serveTemplate("done", pages.Done, w, htmlVariables); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				log.Printf("Template error: %v\n", err)
				app.signalStop()
				return
			}
			app.setStatus("completed", "Transfer completed.")
			if !cfg.KeepAlive {
				app.signalStopAfterStatusGrace()
			}
		case "GET":
			if err := serveTemplate("upload", pages.Upload, w, htmlVariables); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				log.Printf("Template error: %v\n", err)
				app.signalStop()
				return
			}
		}
	})
	// Wait for all wg to be done, then send shutdown signal
	go func() {
		waitgroup.Wait()
		if cfg.KeepAlive || !app.expectParallelRequests {
			return
		}
		app.signalStopAfterStatusGrace()
	}()
	go func() {
		netListener := tcpKeepAliveListener{listener.(*net.TCPListener)}
		if cfg.Secure {
			if err := httpserver.ServeTLS(netListener, cfg.TlsCert, cfg.TlsKey); err != http.ErrServerClosed {
				log.Println("error starting the server:", err)
				app.signalStop()
			}
		} else {
			if err := httpserver.Serve(netListener); err != http.ErrServerClosed {
				log.Println("error starting the server", err)
				app.signalStop()
			}
		}
	}()
	app.instance = httpserver
	return app, nil
}

// openBrowser navigates to a url using the default system browser
func openBrowser(url string) error {
	var err error
	switch runtime.GOOS {
	case "linux":
		err = exec.Command("xdg-open", url).Start()
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = fmt.Errorf("failed to open browser on platform: %s", runtime.GOOS)
	}
	return err
}
