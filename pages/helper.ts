import { NextRequest, NextResponse } from "next/server";
import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { JigsawStack } from "jigsawstack";
import type { Messages } from "../lib/schemas";

const jigsaw = JigsawStack({ apiKey: process.env.NEXT_PUBLIC_JIGSAWSTACK_API_KEY! });
const openai = createOpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!,});

/**
 * Safe JSON parse with fallback
 * @param data Data to parse as JSON
 * @param fallback Fallback value if parsing fails
 */
function safeJsonParse(data: any, fallback: any = {}): any {
  try {
    if (typeof data === 'string') {
      return JSON.parse(data);
    }
    return data;
  } catch (e) {
    console.warn("Failed to parse JSON data:", e);
    return fallback;
  }
}

/**
 * Extract coordinates from text using AI
 * @param text Text containing latitude and longitude information
 * @returns Object with latitude and longitude
 */
async function extractCoordinatesWithAI(text: string): Promise<{ latitude: number | null, longitude: number | null }> {
  if (!text) return { latitude: null, longitude: null };
  
  console.log('[EXTRACT] Processing text with AI to find coordinates');
  
  try {
    const locationData = await generateText({
      model: openai("gpt-4o"),
      system: "Extract geographic coordinates from text. Return valid JSON only.",
      messages: [
        {
          role: "user",
          content: `Extract latitude and longitude from this text. Return ONLY a JSON object with "latitude" and "longitude" as number properties. If coordinates aren't found, return null for those fields:\n\n${text}`
        }
      ],
      temperature: 0.1,
      format: "json"
    });
    
    // Parse the result
    let parsed;
    try {
      if (typeof locationData === 'string') {
        parsed = JSON.parse(locationData);
      } else {
        parsed = locationData;
      }
      
      const latitude = typeof parsed.latitude === 'number' ? parsed.latitude : null;
      const longitude = typeof parsed.longitude === 'number' ? parsed.longitude : null;
      
      console.log(`[EXTRACT] AI found coordinates: ${latitude}, ${longitude}`);
      return { latitude, longitude };
    } catch (parseError) {
      console.error('[EXTRACT] Failed to parse AI response:', parseError);
      return { latitude: null, longitude: null };
    }
  } catch (error) {
    console.error('[EXTRACT] Error using AI to extract coordinates:', error);
    return { latitude: null, longitude: null };
  }
}

/* ─────────── TOOL A – location ─────────── */
const searchLocation = tool({
  description: "Geo-resolve a place name to latitude/longitude",
  parameters: z.object({ query: z.string() }),
  async execute({ query }) {
    console.log(`[TOOL] Running location search for: ${query}`);
    
    try {
      // Only search if query is meaningful
      if (!query || query.trim().length < 3 || query === "I am" || query === "breathe") {
        console.log(`[TOOL] Query too short or vague: "${query}". Skipping search.`);
        return { 
          latitude: null, 
          longitude: null, 
          status: "skipped",
          message: "Location query was too vague or short"
        };
      }

      // Create a search query focused on coordinates
      const searchQuery = `exact coordinates latitude and longitude of ${query}`;
      console.log(`[LOCATION SEARCH] Query: "${searchQuery}"`);
      
      // Use JigsawStack web search API with ai_overview directly
      let response: any;
      try {
        response = await jigsaw.web.search({ 
          query: searchQuery, 
          ai_overview: true 
        });
        
        console.log('[LOCATION SEARCH] Raw response type:', typeof response);
        
        // Extract the ai_overview which contains the summary
        const aiOverview = response?.ai_overview;
        console.log('[LOCATION SEARCH] AI Overview:', aiOverview?.substring(0, 200));
        
        if (!aiOverview) {
          console.log('[LOCATION SEARCH] No AI overview found in response');
          return { 
            latitude: null, 
            longitude: null, 
            status: "no_ai_overview", 
            message: "No AI overview found"
          };
        }
        
        // Use AI to extract coordinates from the ai_overview text
        const { latitude, longitude } = await extractCoordinatesWithAI(aiOverview);
        
        if (latitude === null || longitude === null) {
          console.log('[LOCATION SEARCH] No coordinates found in AI overview');
          return { 
            latitude: null, 
            longitude: null, 
            status: "no_coordinates", 
            message: "No coordinates found in AI overview"
          };
        }
        
        // Return the extracted coordinates
        const result = { 
          latitude, 
          longitude,
          address: query,
          confidence: "high", // AI overview is typically high confidence
          status: "success",
          source: "ai_overview"
        };
        
        console.log('[LOCATION SEARCH] Final result:', result);
        return result;
        
      } catch (apiError) {
        console.error("[LOCATION SEARCH] API call failed:", apiError);
        return { 
          latitude: null, 
          longitude: null, 
          status: "error", 
          message: "Failed to retrieve location data"
        };
      }
    } catch (error) {
      console.error("Error in searchLocation:", error);
      return { 
        latitude: null, 
        longitude: null, 
        status: "error", 
        message: error instanceof Error ? error.message : "Unknown error"
      };
    }
  },
});

/* ─────────── TOOL B – caller profile ─────────── */
const searchPerson = tool({
  description: "Find public profile information about a person",
  parameters: z.object({ name: z.string() }),
  async execute({ name }) {
    console.log(`[TOOL] Running person search for: ${name}`);
    
    try {
      // Only search if name is meaningful
      if (!name || name.trim().length < 3 || name === "I am") {
        console.log(`[PERSON SEARCH] Name too short or vague: "${name}". Skipping search.`);
        return {
          name,
          age: null,
          background: "Name query was too vague or short",
          status: "skipped"
        };
      }

      // Use more specific search query
      const searchQuery = `${name} person biography information age background`;
      console.log(`[PERSON SEARCH] Query: "${searchQuery}"`);
      
      // Use JigsawStack web search API with ai_overview
      let response: any;
      try {
        response = await jigsaw.web.search({ 
          query: searchQuery, 
          ai_overview: true 
        });
        
        console.log('[PERSON SEARCH] Raw response:', typeof response);
        
        // Extract the ai_overview
        const aiOverview = response?.ai_overview;
        console.log('[PERSON SEARCH] AI Overview:', aiOverview?.substring(0, 200));
        
        if (!aiOverview) {
          console.log('[PERSON SEARCH] No AI overview found in response');
          return {
            name,
            age: null,
            background: "No information found",
            status: "no_ai_overview"
          };
        }
        
        // For person information, we'll still use OpenAI to extract structured data
        // because biographical details are more complex than coordinates
        const personData = await generateText({
          model: openai("gpt-4o"),
          system: "Extract biographical information from text. Return valid JSON only.",
          messages: [
            {
              role: "user",
              content: `Extract biographical information about ${name} from this text. Return ONLY a JSON object with "age" as a number (or null if not found) and "background" as a concise description:\n\n${aiOverview}`
            }
          ],
          temperature: 0.2,
          format: "json"
        });
        
        // Parse the JSON response
        let parsed;
        try {
          if (typeof personData === 'string') {
            parsed = JSON.parse(personData);
          } else {
            parsed = personData;
          }
          console.log('[PERSON SEARCH] Parsed person data:', parsed);
        } catch (parseError) {
          console.error('[PERSON SEARCH] Failed to parse person data:', parseError);
          parsed = { age: null, background: aiOverview.substring(0, 200) };
        }
        
        // Create the result
        const result = {
          name,
          age: parsed.age || null,
          background: parsed.background || aiOverview.substring(0, 200),
          status: "success",
          source: "ai_overview"
        };
        
        console.log('[PERSON SEARCH] Final result:', result);
        return result;
        
      } catch (apiError) {
        console.error("[PERSON SEARCH] API call failed:", apiError);
        return {
          name,
          age: null,
          background: "No information found (API error)",
          status: "error"
        };
      }
    } catch (error) {
      console.error("Error in searchPerson:", error);
      return {
        name,
        age: null,
        background: "Error retrieving information",
        status: "error"
      };
    }
  },
});

/**
 * Analyze conversation and extract location and caller profile information
 * @param messages The conversation messages
 * @returns Object containing location and caller profile information
 */
export async function analyzeConversation(messages: Messages) {
  try {
    // Convert messages to format expected by OpenAI, ignoring buffer & sentiment
    const chat = messages.map(({ role, content }) => ({ role, content }));

    // Don't process if there are fewer than 3 messages
    if (chat.length < 3) {
      console.log("[INFO] Too few messages to analyze. Skipping tool execution.");
      return { location: null, callerProfile: null, newMessage: null };
    }

    console.log('[ANALYZE] Starting conversation analysis with message count:', chat.length);
    console.log('[ANALYZE] Last message content:', chat[chat.length - 1]?.content?.substring(0, 100));

    const { steps } = await generateText({
      model: openai("gpt-4o"),
      system:
        "You are looking at a conversation between a 911 operator and caller. Extract information about the caller and their location using the provided tools. IMPORTANT: Only use tools when specific locations or names are mentioned. Don't use the tools for vague terms like 'I am' or single words. If there's no clear name or location to search for, don't use the tools.",
      messages: chat,
      tools: { searchLocation, searchPerson },
      toolChoice: "auto",
      maxSteps: 4,
      temperature: 0.3,
    });

    // Log step decisions
    console.log(`[ANALYZE] Analysis completed with ${steps.length} steps`);
    steps.forEach((step, i) => {
      console.log(`[ANALYZE] Step ${i+1} decided to: ${step.toolCalls?.length ? 
        `call tools: ${step.toolCalls.map(t => t.name).join(', ')}` : 
        'not use any tools'}`);
    });

    // Extract location and caller information from tool results
    let location = null;
    let callerProfile = null;
    let foundInfo = false;

    for (const step of steps) {
      if (step.toolResults && step.toolResults.length > 0) {
        for (const toolResult of step.toolResults) {
          if (toolResult.name === "searchLocation" && toolResult.result) {
            // Only use result if it has actual coordinates
            if (toolResult.result.latitude && toolResult.result.longitude) {
              location = toolResult.result;
              foundInfo = true;
              console.log("[ANALYZE] Location found:", location);
            } else {
              console.log("[ANALYZE] Location tool executed but found no coordinates");
            }
          } else if (toolResult.name === "searchPerson" && toolResult.result) {
            // Only consider profile found if it has substantial info
            if (toolResult.result.background && toolResult.result.background !== "No background found") {
              callerProfile = toolResult.result;
              foundInfo = true;
              console.log("[ANALYZE] Caller profile found:", callerProfile);
            } else {
              console.log("[ANALYZE] Person tool executed but found minimal information");
            }
          }
        }
      } else {
        console.log("[ANALYZE] Step had no tool results or decided not to use tools");
      }
    }

    console.log('[ANALYZE] Final extracted data:', { 
      locationFound: !!location, 
      profileFound: !!callerProfile,
      foundAnyInfo: foundInfo
    });
    
    // Generate a system notification message if we found any information
    let newMessage = null;
    if (foundInfo) {
      const notificationParts = [];
      
      if (location && location.latitude && location.longitude) {
        notificationParts.push(`Location identified: ${location.address || 'Unknown'} (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})`);
      }
      
      if (callerProfile && callerProfile.name) {
        const ageInfo = callerProfile.age ? `, age ${callerProfile.age}` : '';
        notificationParts.push(`Caller identified: ${callerProfile.name}${ageInfo}`);
        
        if (callerProfile.background) {
          notificationParts.push(`Background: ${callerProfile.background}`);
        }
      }
      
      if (notificationParts.length > 0) {
        newMessage = {
          role: "assistant" as const,
          content: `[System] ${notificationParts.join('. ')}`,
          id: crypto.randomUUID(),
          buffer: new ArrayBuffer(0), // Empty buffer for system message
          isSystemNotification: true
        };
        console.log("[ANALYZE] Generated system notification:", newMessage.content);
      }
    }
    
    return { location, callerProfile, newMessage };
    
  } catch (error) {
    console.error("Error analyzing conversation:", error);
    return { location: null, callerProfile: null, newMessage: null };
  }
}

/* ─────────── POST handler (non-stream) ─────────── */
export async function POST(req: NextRequest) {
  const { messages }: { messages: Messages } = await req.json();
  const { location, callerProfile, newMessage } = await analyzeConversation(messages);
  return NextResponse.json({ location, caller: callerProfile, newMessage });
}
