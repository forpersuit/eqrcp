declare module '*.png' {
    const value: string;
    export default value;
}

declare module '*.svg' {
    const value: string;
    export default value;
}

declare module '*.jpg' {
    const value: string;
    export default value;
}

declare module 'morphdom' {
    export default function morphdom(
        fromNode: Node,
        toNode: Node | string,
        options?: Record<string, unknown>
    ): void;
}

interface Window {
    go?: {
        main: {
            App: Record<string, (...args: any[]) => Promise<any>>;
        };
    };
    runtime?: {
        EventsOn: (event: string, callback: (...args: any[]) => void) => void;
        EventsOnMultiple: (event: string, callback: (...args: any[]) => void, count: number) => void;
        OnFileDrop: (callback: (x: number, y: number, paths: string[]) => void) => void;
        LogInfo: (message: string) => void;
        LogError: (message: string) => void;
        BrowserOpenURL?: (url: string) => void;
        WindowMinimise?: () => void;
        WindowMaximise?: () => void;
        WindowUnmaximise?: () => void;
        WindowToggleMaximise?: () => void;
        WindowHide?: () => void;
        WindowShow?: () => void;
        WindowClose?: () => void;
    };
    render?: () => void;
    state?: any;
    renderReceiveDeviceProgressHtml?: (...args: any[]) => string;
}
