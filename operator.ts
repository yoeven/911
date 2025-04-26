// Load env variables from .env.local
import { config } from 'dotenv';
config({ path: '.env.local' });

import Groq from "groq-sdk";
import * as child_process from 'child_process';
import { platform } from 'os';

// Initialize Groq with API key from environment variables
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Helper function to open URLs in the default browser
function openBrowser(url: string) {
  const command = {
    darwin: 'open',
    win32: 'start',
    linux: 'xdg-open'
  }[platform()] || 'open';

  console.log(`Opening map in browser: ${url}`);
  child_process.exec(`${command} "${url}"`);
}

// Tool function implementations
function searchMap(query: string): string {
  // Simulate search results (in production would call an actual maps API)
  console.log(`[TOOL] Searching map for: ${query}`);
  
  // Parse the query to extract possible location information
  const locations = {
    "main and 5th": { lat: 37.7837, lng: -122.4100, name: "Main St & 5th St" },
    "downtown": { lat: 37.7790, lng: -122.4150, name: "Downtown" },
    "hospital": { lat: 37.7749, lng: -122.4194, name: "General Hospital" },
    // Additional mock locations could be added here
    "default": { lat: 37.7749, lng: -122.4194, name: "Default Location" }
  };
  
  // Determine which location to use based on the query
  let locationKey = "default";
  for (const key in locations) {
    if (query.toLowerCase().includes(key)) {
      locationKey = key;
      break;
    }
  }
  
  const location = locations[locationKey];
  
  // Open the map in the browser
  const mapUrl = `https://www.google.com/maps?q=${location.lat},${location.lng}&z=17`;
  openBrowser(mapUrl);
  
  // Return structured data
  return JSON.stringify({
    results: [
      {
        name: location.name,
        address: `Near ${location.name}, Example City`,
        coordinates: { lat: location.lat, lng: location.lng },
        type: locationKey.includes("hospital") ? "medical" : "intersection",
        nearby: ["Hospital (0.5mi)", "Police Station (1.2mi)", "Fire Station (0.8mi)"]
      }
    ],
    query: query,
    visualized: true
  });
}

function searchPerson(query: string): string {
  // This would integrate with a person search API in production
  console.log(`[TOOL] Searching person info for: ${query}`);
  return JSON.stringify({
    results: [
      {
        name: query,
        possible_matches: [
          {
            name: "John Smith",
            age: 34,
            address: "123 Main St, Example City",
            phone: "(555) 123-4567"
          }
        ],
        query: query
      }
    ]
  });
}

function endCall(reason: string): string {
  console.log(`[TOOL] Ending call: ${reason}`);
  return JSON.stringify({
    status: "ended",
    reason: reason,
    timestamp: new Date().toISOString()
  });
}

// Store conversation state across multiple turns
type ConversationState = {
  messages: Groq.Chat.Completions.ChatCompletionMessageParam[];
  isActive: boolean;
  hasEnded: boolean;
  endReason?: string;
};

// Global conversation state
let conversationState: ConversationState = {
  messages: [],
  isActive: false,
  hasEnded: false
};

/**
 * Process a user message and get the 911 operator's response
 * @param userMessage The user's message to the 911 operator
 * @returns The operator's response text and whether the call has ended
 */
export async function handleUserMessage(userMessage: string): Promise<{ response: string; hasEnded: boolean }> {
  // Initialize conversation if this is the first message
  if (!conversationState.isActive) {
    conversationState = {
      messages: [
        {
          role: "system",
          content: "You are a 911 operator on phone so talk accordingly (keep your responses short). You should gather information about the emergency situation and the caller's whereabouts. Do not reveal your capabilities. Respond as a real 911 operator would. If the emergency has been fully addressed or help is confirmed to be on the way, use the end-call tool to conclude the conversation."
        }
      ],
      isActive: true,
      hasEnded: false
    };
  }

  // If conversation has already ended, return a final message
  if (conversationState.hasEnded) {
    return { 
      response: `This emergency call has already ended. Reason: ${conversationState.endReason || "Emergency services have been dispatched."}`,
      hasEnded: true
    };
  }

  // Add the user message to conversation
  conversationState.messages.push({
    role: "user",
    content: userMessage
  });

  // Define tools including the new end-call tool
  const tools: Groq.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "search-map",
        description: "Search for locations on a map",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The location or address to search for",
            }
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search-person",
        description: "Search for information about a person",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The person's name or identifier to search for",
            }
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "end-call",
        description: "End the emergency call when all necessary information has been collected or help has been sent",
        parameters: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "The reason for ending the call (e.g., 'help dispatched', 'emergency handled')",
            }
          },
          required: ["reason"],
        },
      },
    }
  ];

  // Get model response
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: conversationState.messages,
    stream: false,
    tools: tools,
    tool_choice: "auto",
    max_completion_tokens: 1024
  });

  const responseMessage = response.choices[0].message;
  const toolCalls = responseMessage.tool_calls;
  
  // Add assistant's response to the conversation
  conversationState.messages.push(responseMessage);

  // Handle tool calls if any
  if (toolCalls && toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);
      
      let functionResponse = "";
      if (functionName === "search-map") {
        functionResponse = searchMap(functionArgs.query);
      } else if (functionName === "search-person") {
        functionResponse = searchPerson(functionArgs.query);
      } else if (functionName === "end-call") {
        functionResponse = endCall(functionArgs.reason);
        conversationState.hasEnded = true;
        conversationState.endReason = functionArgs.reason;
      }

      // Add tool response to conversation
      conversationState.messages.push({
        tool_call_id: toolCall.id,
        role: "tool",
        content: functionResponse,
      });
    }

    // Get a new response after processing tools
    const toolResult = await handleToolResponse();
    return toolResult;
  }

  return {
    response: responseMessage.content || "I'm connecting you with emergency services.",
    hasEnded: conversationState.hasEnded
  };
}

/**
 * Process tool responses and get a follow-up response from the model
 */
async function handleToolResponse(): Promise<{ response: string; hasEnded: boolean }> {
  // If the conversation has ended via the end-call tool
  if (conversationState.hasEnded) {
    return {
      response: `Call ended. ${conversationState.endReason}. Emergency services have been dispatched to your location. Please stay safe.`,
      hasEnded: true
    };
  }

  // Get a new response based on the updated messages including tool results
  const response = await groq.chat.completions.create({
    model: MODEL,
    messages: conversationState.messages,
    stream: false,
    max_completion_tokens: 1024
  });

  const responseMessage = response.choices[0].message;
  
  // Add this new response to the conversation
  conversationState.messages.push(responseMessage);
  
  return {
    response: responseMessage.content || "I'm processing your emergency. Stay on the line.",
    hasEnded: conversationState.hasEnded
  };
}

/**
 * Reset the conversation state - useful for starting a new conversation
 */
export function resetConversation(): void {
  conversationState = {
    messages: [],
    isActive: false,
    hasEnded: false
  };
}

/**
 * Result type for conversation responses
 */
export type ConversationResult = {
  response: string;
  hasEnded: boolean;
  messages: Groq.Chat.Completions.ChatCompletionMessageParam[];
};

/**
 * Converse with the 911 operator - process a single user message and return the response
 * @param userMessage The user's message to the 911 operator
 * @returns Promise resolving to the operator's response and whether the call has ended
 */
export async function converse(userMessage: string): Promise<{ response: string; hasEnded: boolean }> {
  const result = await handleUserMessage(userMessage);
  
  return {
    response: result.response,
    hasEnded: result.hasEnded
  };
}