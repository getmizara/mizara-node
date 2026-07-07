// Manual type declarations for @modelcontextprotocol/sdk.
// Minimal surface area  -  only what the MCP server file needs.

declare module '@modelcontextprotocol/sdk/server/mcp.js' {
  export class McpServer {
    constructor(options: { name: string; version: string });
    tool(name: string, description: string, inputSchema: unknown, handler: (args: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>): void;
    connect(transport: unknown): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {
    constructor();
  }
}
