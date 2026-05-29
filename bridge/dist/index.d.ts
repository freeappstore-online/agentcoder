interface BridgeConfig {
    token: string;
    sessionId: string;
    apiBase?: string;
}
/**
 * AgentCoder Bridge — connects local tmux sessions to a FAS Room.
 *
 * The bridge:
 * 1. Discovers tmux sessions on the machine
 * 2. Connects to a FAS Room as a peer
 * 3. Polls tmux for output changes and sends them to the Room
 * 4. Receives commands from the UI and sends them to tmux
 */
declare class Bridge {
    private config;
    private room;
    private outputBuffer;
    private maxBufferSize;
    private lastScreens;
    private pollTimer;
    private heartbeatTimer;
    private startTime;
    constructor(config: BridgeConfig);
    start(): void;
    stop(): void;
    private handleMessage;
    private pollSessions;
    private sendOutput;
    private sendHeartbeat;
    private appendBuffer;
}

export { Bridge };
