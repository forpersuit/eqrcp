export namespace main {
	
	export class TaskRecord {
	    id: number;
	    action: string;
	    paths: string[];
	    state: string;
	    transferState?: string;
	    transferMessage?: string;
	    transferMode?: string;
	    transferTarget?: string;
	    transferArchiveName?: string;
	    transferCurrent?: string;
	    transferPercent?: number;
	    bytesDone?: number;
	    bytesTotal?: number;
	    savedFiles?: string[];
	    chatState?: string;
	    chatMessageCount?: number;
	    chatDeviceCount?: number;
	    chatLastActivity?: string;
	    pageUrl?: string;
	    error?: string;
	    // Go type: time
	    startedAt: any;
	    // Go type: time
	    finishedAt?: any;
	
	    static createFrom(source: any = {}) {
	        return new TaskRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.action = source["action"];
	        this.paths = source["paths"];
	        this.state = source["state"];
	        this.transferState = source["transferState"];
	        this.transferMessage = source["transferMessage"];
	        this.transferMode = source["transferMode"];
	        this.transferTarget = source["transferTarget"];
	        this.transferArchiveName = source["transferArchiveName"];
	        this.transferCurrent = source["transferCurrent"];
	        this.transferPercent = source["transferPercent"];
	        this.bytesDone = source["bytesDone"];
	        this.bytesTotal = source["bytesTotal"];
	        this.savedFiles = source["savedFiles"];
	        this.chatState = source["chatState"];
	        this.chatMessageCount = source["chatMessageCount"];
	        this.chatDeviceCount = source["chatDeviceCount"];
	        this.chatLastActivity = source["chatLastActivity"];
	        this.pageUrl = source["pageUrl"];
	        this.error = source["error"];
	        this.startedAt = this.convertValues(source["startedAt"], null);
	        this.finishedAt = this.convertValues(source["finishedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AgentStatus {
	    state: string;
	    current?: TaskRecord;
	    chat?: TaskRecord;
	    queued: number;
	    history?: TaskRecord[];
	    lastError?: string;
	    version: string;
	    // Go type: time
	    agentStartedAt: any;
	    clockTampered: boolean;
	    isPaid: boolean;
	    licenseTier: string;
	    maxDevices: number;
	    activatedDevices: number;
	
	    static createFrom(source: any = {}) {
	        return new AgentStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.current = this.convertValues(source["current"], TaskRecord);
	        this.chat = this.convertValues(source["chat"], TaskRecord);
	        this.queued = source["queued"];
	        this.history = this.convertValues(source["history"], TaskRecord);
	        this.lastError = source["lastError"];
	        this.version = source["version"];
	        this.agentStartedAt = this.convertValues(source["agentStartedAt"], null);
	        this.clockTampered = source["clockTampered"];
	        this.isPaid = source["isPaid"];
	        this.licenseTier = source["licenseTier"];
	        this.maxDevices = source["maxDevices"];
	        this.activatedDevices = source["activatedDevices"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AppInfo {
	    product: string;
	    name: string;
	    version: string;
	    description: string;
	    agentUrl: string;
	    os: string;
	    arch: string;
	    cliPath?: string;
	    logPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product = source["product"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.agentUrl = source["agentUrl"];
	        this.os = source["os"];
	        this.arch = source["arch"];
	        this.cliPath = source["cliPath"];
	        this.logPath = source["logPath"];
	    }
	}
	export class DesktopIntegrationStatus {
	    supported: boolean;
	    enabled: boolean;
	    needsRepair: boolean;
	    detail: string;
	
	    static createFrom(source: any = {}) {
	        return new DesktopIntegrationStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.supported = source["supported"];
	        this.enabled = source["enabled"];
	        this.needsRepair = source["needsRepair"];
	        this.detail = source["detail"];
	    }
	}
	export class InterfaceOption {
	    name: string;
	    ip: string;
	    label: string;
	
	    static createFrom(source: any = {}) {
	        return new InterfaceOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.ip = source["ip"];
	        this.label = source["label"];
	    }
	}
	export class DesktopSettings {
	    configPath: string;
	    interface: string;
	    interfaceOptions: InterfaceOption[];
	    port: number;
	    output: string;
	    browser: boolean;
	    chatAutoSave: boolean;
	    closeBehavior: string;
	    chatSender: string;
	    chatAvatar: string;
	    devMode: boolean;
	    debugLog: boolean;
	    viewportDebug: boolean;
	    autoUpdateMode: string;
	    updateChannel: string;
	    lastUpdateCheckTime: number;
	    updateCheckIntervalHours: number;
	    lang: string;
	
	    static createFrom(source: any = {}) {
	        return new DesktopSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.configPath = source["configPath"];
	        this.interface = source["interface"];
	        this.interfaceOptions = this.convertValues(source["interfaceOptions"], InterfaceOption);
	        this.port = source["port"];
	        this.output = source["output"];
	        this.browser = source["browser"];
	        this.chatAutoSave = source["chatAutoSave"];
	        this.closeBehavior = source["closeBehavior"];
	        this.chatSender = source["chatSender"];
	        this.chatAvatar = source["chatAvatar"];
	        this.devMode = source["devMode"];
	        this.debugLog = source["debugLog"];
	        this.viewportDebug = source["viewportDebug"];
	        this.autoUpdateMode = source["autoUpdateMode"];
	        this.updateChannel = source["updateChannel"];
	        this.lastUpdateCheckTime = source["lastUpdateCheckTime"];
	        this.updateCheckIntervalHours = source["updateCheckIntervalHours"];
	        this.lang = source["lang"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class GUIUpdateCheckResult {
	    new_version_available: boolean;
	    version: string;
	    changelog: string;
	    asset_url: string;
	    asset_name: string;
	    asset_size: number;
	    signature_url: string;
	
	    static createFrom(source: any = {}) {
	        return new GUIUpdateCheckResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.new_version_available = source["new_version_available"];
	        this.version = source["version"];
	        this.changelog = source["changelog"];
	        this.asset_url = source["asset_url"];
	        this.asset_name = source["asset_name"];
	        this.asset_size = source["asset_size"];
	        this.signature_url = source["signature_url"];
	    }
	}
	

}

