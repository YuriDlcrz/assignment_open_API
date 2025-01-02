import WebSocket from "ws";
import {
  getAudioFileFormat,
  initFileRecorder,
  printMessage,
  readGladiaKey,
} from "./helpers";
import { InitiateResponse, StreamingConfig } from "./types";

// Constants
const GLADIA_API_URL = "https://api.gladia.io";
const gladiaKey = readGladiaKey();
const FILE_PATH = "../data/anna-and-sasha-16000.wav";

const STREAMING_CONFIG: StreamingConfig = {
  language_config: {
    languages: ["es", "ru", "en", "fr"],
    code_switching: true,
  },
};

// Initialize a live session with Gladia API
async function initLiveSession(): Promise<InitiateResponse> {
  try {
    const requestBody = {
      ...getAudioFileFormat(FILE_PATH),
      ...STREAMING_CONFIG,
    };

    const response = await fetch(`${GLADIA_API_URL}/v2/live`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GLADIA-KEY": gladiaKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(
        `API Error ${response.status}: ${
          (await response.text()) || response.statusText
        }`
      );
    }

    return response.json();
  } catch (error) {
    console.error("Failed to initialize live session:", error);
    process.exit(1);
  }
}

// Initialize and manage WebSocket connection
function createWebSocketConnection(
  { url }: InitiateResponse,
  onOpen: () => void,
  onMessage: (message: any) => void
): WebSocket {
  const socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    console.log("WebSocket connection established.");
    onOpen();
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data.toString());
      onMessage(message);
    } catch (error) {
      console.error("Error parsing WebSocket message:", error);
    }
  });

  socket.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
    process.exit(1);
  });

  socket.addEventListener("close", ({ code, reason }) => {
    if (code === 1000) {
      console.log("WebSocket connection closed gracefully.");
      process.exit(0);
    } else {
      console.error(`WebSocket closed with code ${code}, reason: ${reason}`);
      process.exit(1);
    }
  });

  return socket;
}

// Start the session
async function start() {
  const initiateResponse = await initLiveSession();

  let socket: WebSocket | null = null;

  const onWebSocketOpen = () => {
    console.log("\n################ Begin session ################\n");

    // Start recording and sending audio chunks
    recorder.start();
  };

  const onWebSocketMessage = (message: any) => {
    printMessage(message);
  };

  const recorder = initFileRecorder(
    // Send audio chunks to the WebSocket
    (chunk) => socket?.send(chunk),
    // Notify the server when recording is stopped
    () => {
      console.log("Recording stopped, sending stop signal to WebSocket.");
      socket?.send(JSON.stringify({ type: "stop_recording" }));
    },
    FILE_PATH
  );

  // Establish WebSocket connection
  socket = createWebSocketConnection(initiateResponse, onWebSocketOpen, onWebSocketMessage);
}

start();
