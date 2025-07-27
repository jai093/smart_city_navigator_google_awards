/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file defines the main `gdm-map-app` LitElement component.
 * This component is responsible for:
 * - Rendering the user interface, including the map from Geoapify,
 *   chat messages area, and user input field.
 * - Managing the state of the chat (e.g., idle, generating, thinking).
 * - Handling user input and sending messages to the Gemini AI model.
 * - Processing responses from the AI, including displaying text and handling
 *   function calls (tool usage) related to map interactions.
 * - Integrating with Geoapify and Leaflet.js to load and control the map,
 *   display markers, polylines for routes, and geocode locations.
 * - Providing the `handleMapQuery` method, which is called by the MCP server
 *   (via index.tsx) to update the map based on AI tool invocations.
 */

import hljs from 'highlight.js';
import * as L from 'leaflet';
import {html, LitElement, PropertyValueMap} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {Marked} from 'marked';
import {markedHighlight} from 'marked-highlight';

import {MapParams} from './mcp_maps_server';

/** Markdown formatting function with syntax hilighting */
export const marked = new Marked(
  markedHighlight({
    async: true,
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang, info) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, {language}).value;
    },
  }),
);

const ICON_BUSY = html`<svg
  class="rotating"
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 -960 960 960"
  width="24px"
  fill="currentColor">
  <path
    d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z" />
</svg>`;

/**
 * Chat state enum to manage the current state of the chat interface.
 */
export enum ChatState {
  IDLE,
  GENERATING,
  THINKING,
  EXECUTING,
}

/**
 * Chat tab enum to manage the current selected tab in the chat interface.
 */
enum ChatTab {
  GEMINI,
}

/**
 * Chat role enum to manage the current role of the message.
 */
export enum ChatRole {
  USER,
  ASSISTANT,
  SYSTEM,
}

// Geoapify API Key: Provided by the user.
let GEOAPIFY_API_KEY = 'c713d7aff8114d3b90b97929071c2752';

const EXAMPLE_PROMPTS = [
  'Show me Mumbai and analyze its public transportation network.',
  'How can Bengaluru improve its traffic management with smart technology?',
  'Analyze the waste management systems in Delhi.',
  'What are the smart city initiatives in Pune?',
  'Show me Chennai and recommend solutions for water management.',
  'Analyze the air quality in Kolkata and suggest improvements.',
  'What smart grid technologies are being used in Hyderabad?',
  'Show me Jaipur and tell me about its heritage conservation efforts using tech.',
  'Can you find a city in India with innovative e-governance solutions?',
  "Let's look at Ahmedabad. What is its Bus Rapid Transit System like?",
  'How could Chandigarh improve its urban green spaces?',
];

/**
 * MapApp component with Geoapify and Leaflet.js.
 */
@customElement('gdm-map-app')
export class MapApp extends LitElement {
  @query('#anchor') anchor?: HTMLDivElement;
  @query('#mapContainer') mapContainerElement?: HTMLElement;
  @query('#messageInput') messageInputElement?: HTMLInputElement;

  @state() chatState = ChatState.IDLE;
  @state() isRunning = true;
  @state() selectedChatTab = ChatTab.GEMINI;
  @state() inputMessage = '';
  @state() messages: HTMLElement[] = [];
  @state() mapInitialized = false;
  @state() mapError = '';

  private map?: L.Map;
  private markers: L.Marker[] = [];
  private routeLayer?: L.GeoJSON;

  sendMessageHandler?: CallableFunction;

  constructor() {
    super();
    this.setNewRandomPrompt();
  }

  createRenderRoot() {
    return this;
  }

  protected firstUpdated(
    _changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>,
  ): void {
    this.initializeMap();
  }

  private setNewRandomPrompt() {
    if (EXAMPLE_PROMPTS.length > 0) {
      this.inputMessage =
        EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)];
    }
  }

  async initializeMap() {
    if (!GEOAPIFY_API_KEY) {
      this.mapError = `Geoapify API Key is not configured correctly. Please edit the
<code>map_app.ts</code> file and ensure the <code>GEOAPIFY_API_KEY</code> is set.`;
      console.error('Geoapify API Key is not configured.');
      this.requestUpdate();
      return;
    }

    if (!this.mapContainerElement) {
      console.error('Map container element not found.');
      this.mapError = 'Map container could not be found in the DOM.';
      this.requestUpdate();
      return;
    }

    try {
      this.map = L.map(this.mapContainerElement).setView([20, 0], 2);

      L.tileLayer(
        `https://maps.geoapify.com/v1/tile/osm-liberty/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_API_KEY}`,
        {
          attribution:
            'Powered by <a href="https://www.geoapify.com/" target="_blank">Geoapify</a> | © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
          maxZoom: 20,
        },
      ).addTo(this.map);

      this.map.on('load', () => {
        this.mapInitialized = true;
        this.mapError = '';
        console.log('Leaflet map initialized successfully.');
        this.requestUpdate();
      });
      // For Leaflet, 'load' might not be the event, it's generally ready after init.
      this.mapInitialized = true;
      this.requestUpdate();
    } catch (error) {
      console.error('Error initializing Leaflet map:', error);
      this.mapError = `Could not load map. Check console for details. Error: ${error}`;
      this.mapInitialized = false;
      this.requestUpdate();
    }
  }

  setChatState(state: ChatState) {
    this.chatState = state;
  }

  private _clearMapElements() {
    if (!this.map) return;
    this.markers.forEach((marker) => this.map!.removeLayer(marker));
    this.markers = [];

    if (this.routeLayer) {
      this.map.removeLayer(this.routeLayer);
      this.routeLayer = undefined;
    }
  }

  private async _handleViewLocation(locationQuery: string) {
    if (!this.mapInitialized || !this.map) {
      this.displayMapNotReadyError('display locations');
      return;
    }
    this._clearMapElements();

    try {
      const response = await fetch(
        `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(
          locationQuery,
        )}&limit=1&apiKey=${GEOAPIFY_API_KEY}`,
      );
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      const data = await response.json();

      if (data.features && data.features.length > 0) {
        const {lon, lat} = data.features[0].properties;
        this.map.flyTo([lat, lon], 13);
        const marker = L.marker([lat, lon]).addTo(this.map);
        this.markers.push(marker);
      } else {
        throw new Error('Location not found.');
      }
    } catch (error) {
      console.error(`Geocoding error for "${locationQuery}":`, error);
      this.displayErrorInChat(`Could not find location: ${locationQuery}.`);
    }
  }

  private async _handleDirections(
    originQuery: string,
    destinationQuery: string,
  ) {
    if (!this.mapInitialized || !this.map) {
      this.displayMapNotReadyError('get directions');
      return;
    }
    this._clearMapElements();

    try {
      const geocodeUrl = (text: string) =>
        `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(
          text,
        )}&limit=1&apiKey=${GEOAPIFY_API_KEY}`;

      const [originResponse, destinationResponse] = await Promise.all([
        fetch(geocodeUrl(originQuery)),
        fetch(geocodeUrl(destinationQuery)),
      ]);

      if (!originResponse.ok || !destinationResponse.ok) {
        throw new Error('Failed to geocode one or both locations.');
      }

      const [originData, destinationData] = await Promise.all([
        originResponse.json(),
        destinationResponse.json(),
      ]);

      if (!originData.features?.[0] || !destinationData.features?.[0]) {
        throw new Error('Could not find coordinates for origin or destination.');
      }

      const originCoords = originData.features[0].properties;
      const destinationCoords = destinationData.features[0].properties;

      const routingUrl = `https://api.geoapify.com/v1/routing?waypoints=${originCoords.lat},${originCoords.lon}|${destinationCoords.lat},${destinationCoords.lon}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`;
      const routeResponse = await fetch(routingUrl);
      if (!routeResponse.ok) {
        throw new Error(`Routing API failed with status ${routeResponse.status}`);
      }
      const routeData = await routeResponse.json();

      if (routeData.features && routeData.features.length > 0) {
        this.routeLayer = L.geoJSON(routeData.features[0], {
          style: () => ({
            color: '#007cbf',
            weight: 8,
          }),
        }).addTo(this.map);

        const originMarker = L.marker([originCoords.lat, originCoords.lon])
          .addTo(this.map)
          .bindPopup('Origin');
        const destinationMarker = L.marker([
          destinationCoords.lat,
          destinationCoords.lon,
        ])
          .addTo(this.map)
          .bindPopup('Destination');
        this.markers.push(originMarker, destinationMarker);

        this.map.fitBounds(this.routeLayer.getBounds(), {padding: [50, 50]});
      } else {
        throw new Error('No route found between the locations.');
      }
    } catch (error) {
      console.error(
        `Directions error from "${originQuery}" to "${destinationQuery}":`,
        error,
      );
      this.displayErrorInChat(
        `Could not get directions from "${originQuery}" to "${destinationQuery}".`,
      );
    }
  }

  async handleMapQuery(params: MapParams) {
    if (params.location) {
      this._handleViewLocation(params.location);
    } else if (params.origin && params.destination) {
      this._handleDirections(params.origin, params.destination);
    } else if (params.destination) {
      this._handleViewLocation(params.destination);
    }
  }

  private async displayMapNotReadyError(action: string) {
    const errorMessage = `Map is not ready to ${action}. Please check configuration.`;
    if (!this.mapError) {
      this.displayErrorInChat(errorMessage);
    }
    console.warn(errorMessage);
  }

  private async displayErrorInChat(errorMessage: string) {
    const {textElement} = this.addMessage('error', 'Processing error...');
    textElement.innerHTML = await marked.parse(errorMessage);
  }

  setInputField(message: string) {
    this.inputMessage = message.trim();
  }

  addMessage(role: string, message: string) {
    const div = document.createElement('div');
    div.classList.add('turn');
    div.classList.add(`role-${role.trim()}`);
    div.setAttribute('aria-live', 'polite');

    const thinkingDetails = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Thinking process';
    thinkingDetails.classList.add('thinking');
    thinkingDetails.setAttribute('aria-label', 'Model thinking process');
    const thinkingElement = document.createElement('div');
    thinkingDetails.append(summary);
    thinkingDetails.append(thinkingElement);
    div.append(thinkingDetails);

    const textElement = document.createElement('div');
    textElement.className = 'text';
    textElement.innerHTML = message;
    div.append(textElement);

    const sourcesContainer = document.createElement('div');
    sourcesContainer.className = 'sources-container hidden';
    sourcesContainer.setAttribute('aria-label', 'Web sources for the response');
    div.append(sourcesContainer);

    this.messages = [...this.messages, div];
    this.scrollToTheEnd();
    return {
      thinkingContainer: thinkingDetails,
      thinkingElement: thinkingElement,
      textElement: textElement,
      sourcesContainer: sourcesContainer,
    };
  }

  scrollToTheEnd() {
    if (!this.anchor) return;
    this.anchor.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }

  async sendMessageAction(message?: string, role?: string) {
    if (this.chatState !== ChatState.IDLE) return;

    let msg = '';
    let usedComponentInput = false;

    if (message) {
      msg = message.trim();
    } else {
      msg = this.inputMessage.trim();
      if (msg.length > 0) {
        this.inputMessage = '';
        usedComponentInput = true;
      } else if (
        this.inputMessage.trim().length === 0 &&
        this.inputMessage.length > 0
      ) {
        this.inputMessage = '';
        usedComponentInput = true;
      }
    }

    if (msg.length === 0) {
      if (usedComponentInput) {
        this.setNewRandomPrompt();
      }
      return;
    }

    const msgRole = role ? role.toLowerCase() : 'user';

    if (msgRole === 'user' && msg) {
      const {textElement} = this.addMessage(msgRole, '...');
      textElement.innerHTML = await marked.parse(msg);
    }

    if (this.sendMessageHandler) {
      await this.sendMessageHandler(msg, msgRole);
    }

    if (usedComponentInput) {
      this.setNewRandomPrompt();
    }
  }

  private async inputKeyDownAction(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessageAction();
    }
  }

  render() {
    return html`<div class="gdm-map-app">
      <div
        class="main-container"
        role="application"
        aria-label="Smart City Navigator">
        ${this.mapError
          ? html`<div
              class="map-error-message"
              role="alert"
              aria-live="assertive"
              >${this.mapError}</div>`
          : ''}
        <div
          id="mapContainer"
          style="height: 100%; width: 100%;"
          aria-label="Interactive Map Display from Geoapify"
          role="application"></div>
      </div>
      <div class="sidebar" role="complementary" aria-labelledby="chat-heading">
        <div class="selector" role="tablist" aria-label="Chat providers">
          <button
            id="geminiTab"
            role="tab"
            aria-selected=${this.selectedChatTab === ChatTab.GEMINI}
            aria-controls="chat-panel"
            class=${classMap({
              'selected-tab': this.selectedChatTab === ChatTab.GEMINI,
            })}
            @click=${() => {
              this.selectedChatTab = ChatTab.GEMINI;
            }}>
            <span id="chat-heading">Smart City Assistant</span>
          </button>
        </div>
        <div
          id="chat-panel"
          role="tabpanel"
          aria-labelledby="geminiTab"
          class=${classMap({
            'tabcontent': true,
            'showtab': this.selectedChatTab === ChatTab.GEMINI,
          })}>
          <div class="chat-messages" aria-live="polite" aria-atomic="false">
            ${this.messages}
            <div id="anchor"></div>
          </div>
          <div class="footer">
            <div
              id="chatStatus"
              aria-live="assertive"
              class=${classMap({'hidden': this.chatState === ChatState.IDLE})}>
              ${this.chatState === ChatState.GENERATING
                ? html`${ICON_BUSY} Generating...`
                : html``}
              ${this.chatState === ChatState.THINKING
                ? html`${ICON_BUSY} Thinking...`
                : html``}
              ${this.chatState === ChatState.EXECUTING
                ? html`${ICON_BUSY} Executing...`
                : html``}
            </div>
            <div
              id="inputArea"
              role="form"
              aria-labelledby="message-input-label">
              <label id="message-input-label" class="hidden"
                >Type your message</label
              >
              <input
                type="text"
                id="messageInput"
                .value=${this.inputMessage}
                @input=${(e: InputEvent) => {
                  this.inputMessage = (e.target as HTMLInputElement).value;
                }}
                @keydown=${(e: KeyboardEvent) => {
                  this.inputKeyDownAction(e);
                }}
                placeholder="Ask about a city..."
                autocomplete="off"
                aria-labelledby="message-input-label"
                aria-describedby="sendButton-desc" />
              <button
                id="sendButton"
                @click=${() => {
                  this.sendMessageAction();
                }}
                aria-label="Send message"
                aria-describedby="sendButton-desc"
                ?disabled=${this.chatState !== ChatState.IDLE}
                class=${classMap({
                  'disabled': this.chatState !== ChatState.IDLE,
                })}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  height="30px"
                  viewBox="0 -960 960 960"
                  width="30px"
                  fill="currentColor"
                  aria-hidden="true">
                  <path d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z" />
                </svg>
              </button>
              <p id="sendButton-desc" class="hidden"
                >Sends the typed message to the AI.</p
              >
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }
}
