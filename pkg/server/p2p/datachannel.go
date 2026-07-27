package p2p

import (
	"errors"
	"io"
	"sync"

	"github.com/pion/webrtc/v3"
)

// DataChannelConn wraps a pion DataChannel to provide an io.ReadWriteCloser interface.
type DataChannelConn struct {
	dc        *webrtc.DataChannel
	readBuf   []byte
	readMu    sync.Mutex
	readCond  *sync.Cond
	isClosed  bool
	closeOnce sync.Once
}

// NewDataChannelConn creates a stream wrapper over a WebRTC DataChannel.
func NewDataChannelConn(dc *webrtc.DataChannel) *DataChannelConn {
	conn := &DataChannelConn{
		dc:      dc,
		readBuf: make([]byte, 0),
	}
	conn.readCond = sync.NewCond(&conn.readMu)

	// Bind DataChannel message event handler
	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		conn.readMu.Lock()
		conn.readBuf = append(conn.readBuf, msg.Data...)
		conn.readCond.Signal()
		conn.readMu.Unlock()
	})

	// Bind DataChannel close event handler
	dc.OnClose(func() {
		conn.Close()
	})

	return conn
}

// Read reads binary data received from the remote peer via DataChannel.
func (c *DataChannelConn) Read(p []byte) (n int, err error) {
	c.readMu.Lock()
	defer c.readMu.Unlock()

	for len(c.readBuf) == 0 {
		if c.isClosed {
			return 0, io.EOF
		}
		c.readCond.Wait()
	}

	n = copy(p, c.readBuf)
	c.readBuf = c.readBuf[n:]
	return n, nil
}

// Write sends binary data over the DataChannel.
func (c *DataChannelConn) Write(p []byte) (n int, err error) {
	c.readMu.Lock()
	if c.isClosed {
		c.readMu.Unlock()
		return 0, errors.New("data channel is closed")
	}
	c.readMu.Unlock()

	err = c.dc.Send(p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

// Close closes the DataChannel stream.
func (c *DataChannelConn) Close() error {
	c.closeOnce.Do(func() {
		c.readMu.Lock()
		c.isClosed = true
		c.readCond.Broadcast()
		c.readMu.Unlock()

		_ = c.dc.Close()
	})
	return nil
}
