/**
 * Read-only agency-level GoHighLevel MCP server.
 *
 * Agency private-integration tokens can enumerate and inspect sub-accounts, but
 * cannot be substituted for location tokens when operating on contacts and
 * other location-owned resources. This server therefore exposes exactly two
 * verified read-only tools.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { GHLApiClient } from './clients/ghl-api-client.js';
import { LocationTools } from './tools/location-tools.js';
import {
  createAgencyConfig,
  executeAgencyTool,
  getAgencyToolDefinitions,
  testAgencyConnection,
} from './agency-mode.js';

class GHLAgencyMCPServer {
  private readonly server: Server;
  private readonly ghlClient: GHLApiClient;
  private readonly locationTools: LocationTools;

  constructor() {
    this.server = new Server(
      { name: 'ghl-agency-mcp-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    this.ghlClient = new GHLApiClient(createAgencyConfig());
    this.locationTools = new LocationTools(this.ghlClient);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: getAgencyToolDefinitions(this.locationTools),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await executeAgencyTool(this.locationTools, name, args || {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = message.startsWith('Tool is not available')
          ? ErrorCode.MethodNotFound
          : ErrorCode.InternalError;
        throw new McpError(code, message);
      }
    });
  }

  async start(): Promise<void> {
    process.stderr.write('[GHL Agency MCP] Testing agency location access...\n');
    const visibleLocationCount = await testAgencyConnection(this.ghlClient);
    process.stderr.write(
      `[GHL Agency MCP] Agency access confirmed (${visibleLocationCount} location returned by startup probe).\n`,
    );

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    process.stderr.write('[GHL Agency MCP] Ready with 2 read-only tools.\n');
  }
}

function setupGracefulShutdown(): void {
  const shutdown = (signal: string) => {
    process.stderr.write(`\n[GHL Agency MCP] Received ${signal}; shutting down.\n`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function main(): Promise<void> {
  setupGracefulShutdown();
  const server = new GHLAgencyMCPServer();
  await server.start();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[GHL Agency MCP] Fatal: ${message}\n`);
  process.exit(1);
});
