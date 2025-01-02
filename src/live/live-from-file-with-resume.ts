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

// Initialize a live session with the API
async function initLiveSession(): Promise<InitiateResponse> {
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
    console.error(
      `Error ${response.status}: ${await response.text() || response.statusText}`
    );
    process.exit(response.status);
  }

  return response.json();
}

// Initialize WebSocket client and manage its behavior
function initWebSocketClient({ url }: InitiateResponse) {
  let socket: WebSocket | null = null;
  let audioBuffer = Buffer.alloc(0);
  let bytesSent = 0;
  let stopRecording = false;

  const reconnectWebSocket = async () => {
    console.log(">>>>> Reconnecting WebSocket...");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    initializeWebSocket();
  };

  const initializeWebSocket = () => {
    console.log(">>>>> Connecting to WebSocket");
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      console.log(">>>>> WebSocket connected");
      if (audioBuffer.byteLength) {
        socket?.send(audioBuffer);
        audioBuffer = Buffer.alloc(0);
      }
      if (stopRecording) {
        socket?.send(JSON.stringify({ type: "stop_recording" }));
      }
    });

    socket.addEventListener("error", (error) => {
      console.error("WebSocket error:", error);
      process.exit(1);
    });

    socket.addEventListener("close", async ({ code }) => {
      console.log(`>>>>> WebSocket closed with code ${code}`);
      if (code !== 1000 && !stopRecording) {
        await reconnectWebSocket();
      } else {
        process.exit(0);
      }
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      printMessage(message);

      if (message.type === "audio_chunk" && message.acknowledged) {
        audioBuffer = audioBuffer.subarray(
          message.data.byte_range[1] - bytesSent
        );
        bytesSent = message.data.byte_range[1];
      }
    });
  };

  initializeWebSocket();

  return {
    sendAudioChunk: (chunk: Buffer) => {
      audioBuffer = Buffer.concat([audioBuffer, chunk]);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(chunk);
      }
    },
    stopRecording: () => {
      stopRecording = true;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "stop_recording" }));
      }
    },
    forceClose: () => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.close(4500);
      }
    },
  };
}

// Start the live audio session
async function start() {
  const sessionResponse = await initLiveSession();
  const client = initWebSocketClient(sessionResponse);

  let closeInterval: NodeJS.Timeout | null = null;

  const recorder = initFileRecorder(
    (chunk) => client.sendAudioChunk(chunk), // Send audio chunk
    () => {
      if (closeInterval) clearInterval(closeInterval);
      client.stopRecording();
    },
    FILE_PATH
  );

  console.log("\n################ Begin session ################\n");

  recorder.start();

  // Periodically force-close the WebSocket to ensure stability
  closeInterval = setInterval(() => {
    client.forceClose();
  }, 10_000);
}

start();
