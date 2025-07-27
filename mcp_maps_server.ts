/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file defines and runs an MCP (Model Context Protocol) server.
 * The server exposes tools that an AI model (like Gemini) can call to interact
 * with the mapping functionality. These tools include:
 * - `view-location`: To display a specific location.
 * - `get-directions`: To get and display directions.
 *
 * When the AI decides to use one of these tools, the MCP server receives the
 * call and then uses the `mapQueryHandler` callback to send the relevant
 * parameters (location, origin/destination) to the frontend
 * (MapApp component in map_app.ts) to update the map display.
 */

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {z} from 'zod';

export interface MapParams {
  location?: string;
  origin?: string;
  destination?: string;
}

export async function startMcpMapServer(
  transport: Transport,
  /**
   * Callback function provided by the frontend (index.tsx) to handle map updates.
   * This function is invoked when an AI tool call requires a map interaction,
   * passing the necessary parameters to update the map view (e.g., show location,
   * display directions). It is the bridge between MCP server tool execution and
   * the visual map representation in the MapApp component.
   */
  mapQueryHandler: (params: MapParams) => void,
) {
  // Create an MCP server
  const server = new McpServer({
    name: 'AI Studio Map Controller',
    version: '1.0.0',
  });

  server.tool(
    'view-location',
    'View a specific geographical location on the map. Use this to show a city or point of interest when requested by the user.',
    {
      location: z.string().describe(
        'The city, address, or landmark to display. For example: "Paris" or "Eiffel Tower".',
      ),
    },
    async ({location}) => {
      mapQueryHandler({location});
      return {
        content: [{type: 'text', text: `Navigating to: ${location}`}],
      };
    },
  );

  server.tool(
    'get-directions',
    'Search for directions from an origin to a destination and display the route on the map.',
    {origin: z.string(), destination: z.string()},
    async ({origin, destination}) => {
      mapQueryHandler({origin, destination});
      return {
        content: [
          {type: 'text', text: `Navigating from ${origin} to ${destination}`},
        ],
      };
    },
  );

  await server.connect(transport);
  console.log('server running');
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
