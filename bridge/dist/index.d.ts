interface BridgeConfig {
    token: string;
    sessionId: string;
    apiBase?: string;
    watchList?: string[];
}
interface BridgeEvents {
    onConnected?: () => void;
    onDisconnected?: () => void;
    onError?: (reason: string) => void;
    onPeers?: (peers: string[]) => void;
    onSessions?: (names: string[]) => void;
    onSessionState?: (agent: string, state: 'ready' | 'busy' | 'waiting') => void;
    onOutput?: (agent: string, bytes: number) => void;
    onCommand?: (from: string, agent: string, text: string) => void;
    onControl?: (from: string, action: string) => void;
}
/**
 * AgentCoder Bridge — connects local tmux sessions to a FAS Room.
 */
declare class Bridge {
    private config;
    private events;
    private room;
    private lastScreens;
    private pollTimer;
    private heartbeatTimer;
    private startTime;
    private msgSeq;
    private watchSet;
    private targetOverrides;
    constructor(config: BridgeConfig, events?: BridgeEvents);
    start(): void;
    setWatchList(watched: Map<string, string | undefined>): void;
    private replayCurrentScreens;
    stop(): void;
    private handleMessage;
    private pollSessions;
    private sendOutput;
    private sendHeartbeat;
}

export { Bridge, type BridgeEvents };
