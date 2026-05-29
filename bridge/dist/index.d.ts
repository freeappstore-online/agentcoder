interface BridgeConfig {
    token: string;
    sessionId: string;
    apiBase?: string;
}
interface BridgeEvents {
    onConnected?: () => void;
    onDisconnected?: () => void;
    onPeers?: (peers: string[]) => void;
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
    private outputBuffer;
    private maxBufferSize;
    private lastScreens;
    private pollTimer;
    private heartbeatTimer;
    private startTime;
    private msgSeq;
    constructor(config: BridgeConfig, events?: BridgeEvents);
    start(): void;
    stop(): void;
    private handleMessage;
    private pollSessions;
    private sendOutput;
    private sendHeartbeat;
    private appendBuffer;
}

export { Bridge, type BridgeEvents };
