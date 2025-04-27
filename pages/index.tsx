import { Box, Flex, Heading, IconButton, List, Text } from "@chakra-ui/react";
import { MicVAD, utils } from "@ricky0123/vad-web";
import { Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { JigsawStack } from "jigsawstack";
import Groq from "groq-sdk";
import { createGroq } from "@ai-sdk/groq";
import { generateText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import AudioVisualizer from "@/components/AudioVisualizer";
import { z } from "zod";
import MapCard from "@/components/MapCard";

const jigsaw = JigsawStack({
  apiKey: process.env.NEXT_PUBLIC_JIGSAWSTACK_API_KEY,
});
const groqSDK = new Groq({ apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY, dangerouslyAllowBrowser: true });
const groq = createGroq({
  apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY,
});
const openai = createOpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
});

export default function Home() {
  const systemPrompt = `Current ISO datetime: ${new Date().toISOString()}. You're the police operator for the 911 system. You're responsible for taking calls from the public and managing the situation. Your goal is to help the caller, decide to dispatch the police or not. You have to try your best to calm the caller down and get them to tell you what's going on. Get as much information as possible from the caller, and then decide if you need to dispatch the police or not. Make sure to stay on the line with the caller until the police arrive. Get as much info as possible from the caller. Ask one question at a time, only respond with short quick responses that's fast to speak out. Max 2 sentences at a time. Spell out 911 when you need to say it.`;
  const [onCall, setOnCall] = useState(false);
  const [messages, setMessages] = useState<
    {
      role: "assistant" | "user";
      content: string;
      id: string;
      buffer: ArrayBuffer;
      sentiment?: string;
    }[]
  >([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioSpeaker = useRef<HTMLAudioElement>(null);
  const vad = useRef<MicVAD>(null);
  const [lastSentiment, setLastSentiment] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [locationSearch, setLocationSearch] = useState<{
    address: string;
    latitude: number;
    longitude: number;
  } | null>(null);
  const [humanResearch, setHumanResearch] = useState<{
    overview: string;
    images: string[];
  } | null>(null);

  useEffect(() => {
    audioSpeaker.current = new Audio();
  }, []);

  useEffect(() => {
    if (!isSpeaking) {
      const atLeastOneUnresponded = messages.length > 0 && messages[messages.length - 1].role === "user";
      if (atLeastOneUnresponded) {
        respond();
      }
    }
  }, [isSpeaking]);

  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === "user") {
      asyncChecks();
    }
  }, [messages?.length]);

  const handleCall = async () => {
    setOnCall(true);
    vad.current = await MicVAD.new({
      onSpeechEnd: onSpeechEnd,
      onSpeechStart: () => {
        console.log("User started talking");
        if (!audioSpeaker.current?.paused) {
          audioSpeaker?.current?.pause();
        }
        setIsSpeaking(true);
      },
      // minSpeechFrames: 5,
      // model: "v5",
      // positiveSpeechThreshold: 0.75,
    });
    vad.current?.start();
  };

  const handleEndCall = () => {
    console.log("ending call");
    vad.current?.pause();
    setOnCall(false);
    setIsSpeaking(false);
  };

  const onSpeechEnd = async (audio: Float32Array) => {
    console.log("speech ended");
    const wavBuffer = utils.encodeWAV(audio);
    const transcript = await transcribeAudio(wavBuffer);
    const id = crypto.randomUUID();
    setMessages((prev) => [...prev, { role: "user", content: transcript, id, buffer: wavBuffer }]);
    setIsSpeaking(false);
  };

  const asyncChecks = async () => {
    const lastMessage = messages[messages.length - 1];

    const [sentiment, summary, toolResponse] = await Promise.all([
      jigsaw.sentiment({
        text: lastMessage.content,
      }),
      jigsaw.summary({
        text: messages.map((message) => message.content).join("\n"),
        type: "points",
      }),
      generateObject({
        model: openai("gpt-4o"),
        prompt: `Decide the relevant services to use based on the content of the conversation. Return the params of the tool in a JSON format, if the tool is not suppose to be used, return null. Message content: ${lastMessage.content}`,
        schema: z.object({
          "geo-location-search": z
            .object({
              query: z.string().nullable(),
              should_use: z.boolean(),
            })
            .describe("Search the web for a given location, when a location, place or address is mentioned"),
          "human-web-search": z
            .object({
              query: z.string().nullable(),
              should_use: z.boolean(),
            })
            .describe("Search the web for a given person, when a person is mentioned"),
        }),
      }),
    ]);
    const toolResp = toolResponse.object;

    console.log("toolResp", toolResp);

    const [geoLocationSearch, humanWebSearch] = await Promise.all([
      toolResp["geo-location-search"]?.should_use && toolResp["geo-location-search"]?.query
        ? fetch("https://places.googleapis.com/v1/places:searchText", {
            headers: {
              "X-Goog-Api-Key": process.env.NEXT_PUBLIC_GOOGLE_MAP_API_KEY!,
              "X-Goog-FieldMask": "*",
            },
            method: "POST",
            body: JSON.stringify({
              textQuery: toolResp["geo-location-search"].query + " San Francisco, USA",
            }),
          }).then((res) => res.json())
        : null,
      toolResp["human-web-search"].should_use && toolResp["human-web-search"].query
        ? jigsaw.web.search({
            query: "Short research on " + toolResp["human-web-search"].query,
          })
        : null,
    ]);

    if (geoLocationSearch) {
      console.log("geoData", geoLocationSearch);
      const geoData = geoLocationSearch?.places?.[0];
      if (geoData) {
        setLocationSearch({
          address: geoData.formattedAddress,
          latitude: geoData.location.latitude,
          longitude: geoData.location.longitude,
        });
      }
    }

    if (humanWebSearch) {
      const imageUrls = (humanWebSearch as any).image_urls.slice(0, 3);
      setHumanResearch({
        overview: humanWebSearch.ai_overview,
        images: imageUrls,
      });
    }

    // console.log("toolResponse", toolResponse.steps[toolResponse.steps.length - 1].tool_calls);
    setLastSentiment(sentiment.sentiment.emotion);
    setSummary(summary.summary);
    setMessages((prev) => {
      let newMessages = [...prev];
      const index = newMessages.findIndex((message) => message.id === lastMessage.id);
      if (index !== -1) {
        newMessages[index].sentiment = sentiment.sentiment.emotion;
      }
      return newMessages;
    });
  };

  const transcribeAudio = async (buffer: ArrayBuffer) => {
    const response = await groqSDK.audio.transcriptions.create({
      file: new File([buffer], "audio.wav", { type: "audio/wav" }),
      model: "whisper-large-v3-turbo",
    });

    return response.text;
  };

  const respond = async () => {
    console.log("responding");
    const lastID = messages?.[messages.length - 1]?.id || null;
    const response = await generateText({
      model: groq("meta-llama/llama-4-maverick-17b-128e-instruct"),
      system: systemPrompt,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content + (message.sentiment ? `\n\nUser Sentiment: ${message.sentiment}` : ""),
      })),
    });

    if (messages[messages.length - 1].id !== lastID || isSpeaking) {
      return;
    }

    const responseText = response.text;

    const audio = await jigsaw.audio.text_to_speech({
      text: responseText,
      accent: "en-AU-female-5",
    });

    if (messages[messages.length - 1].id !== lastID || isSpeaking) {
      return;
    }

    const blob = await audio.blob();
    const arrayBuffer = await blob.arrayBuffer();

    if (messages[messages.length - 1].id !== lastID || isSpeaking) {
      return;
    }

    if (!audioSpeaker.current) {
      return;
    }

    audioSpeaker.current.pause();
    audioSpeaker.current.src = URL.createObjectURL(new Blob([arrayBuffer], { type: "audio/wav" }));
    audioSpeaker.current.currentTime = 0;
    audioSpeaker.current.playbackRate = 1.3;
    audioSpeaker.current.play();

    setMessages((prev) => [...prev, { role: "assistant", content: responseText, id: crypto.randomUUID(), buffer: arrayBuffer }]);
  };

  return (
    <Flex minH={"100vh"} justifyContent={"center"} alignItems={"center"} flexDir={"column"} p={"2rem"} w={"100%"}>
      <Flex w={"100%"} minH={"3xs"} gap={"3rem"}>
        {summary && (
          <Flex flexDir={"column"} gap={2} maxW={"sm"}>
            <Heading size={"lg"}>Breakdown</Heading>
            <List.Root>
              {summary?.map((point) => (
                <List.Item key={point}>{point}</List.Item>
              ))}
            </List.Root>
          </Flex>
        )}
        {lastSentiment && (
          <Flex flexDir={"column"} gap={2} maxW={"sm"}>
            <Heading size={"lg"}>Sentiment</Heading>
            <Text>{lastSentiment}</Text>
          </Flex>
        )}
        {locationSearch && (
          <Flex flexDir={"column"} gap={2} maxW={"sm"}>
            <Heading size={"lg"}>Location</Heading>
            <MapCard latitude={locationSearch.latitude} longitude={locationSearch.longitude} zoom={15} />
            <Text>{locationSearch.address}</Text>
          </Flex>
        )}
      </Flex>
      <IconButton my={"2rem"} size={"2xl"} color={onCall ? "tomato" : "green"} onClick={onCall ? handleEndCall : handleCall}>
        <Phone />
      </IconButton>
      {isSpeaking && <Text>Speaking</Text>}
      {onCall && <AudioVisualizer />}
      <Flex w={"100%"} justifyContent={"space-around"}>
        <Flex flexDir={"column"} gap={2} w={"xl"} h={"sm"} overflowY={"auto"}>
          {[...messages].reverse().map((message, index) => (
            <Flex key={message.id} flexDir={"column"} gap={2}>
              <Flex alignItems={"center"} gap={2}>
                <Text fontSize={"sm"}>{message.role}</Text>
                {message?.sentiment && <Text fontSize={"sm"}>{`(${message.sentiment})`}</Text>}
              </Flex>
              <Flex gap={2}>
                <Box asChild h={"2.5rem"}>
                  <audio src={URL.createObjectURL(new Blob([message.buffer], { type: "audio/wav" }))} controls />
                </Box>
                <Text fontSize={"xs"} maxW={"3xs"}>
                  {message.content}
                </Text>
              </Flex>
            </Flex>
          ))}
        </Flex>
        {humanResearch && (
          <Flex flexDir={"column"} gap={2} maxW={"sm"}>
            <Heading size={"lg"}>Human Research</Heading>
            <Text lineClamp={10} fontSize={"sm"}>
              {humanResearch.overview}
            </Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
