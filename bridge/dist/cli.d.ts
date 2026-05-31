#!/usr/bin/env node
declare function parseStartArgs(cliArgs: string[]): {
    sessionId: string;
    token: string;
    apiBase: string | undefined;
    watchList: string[] | undefined;
};

export { parseStartArgs };
