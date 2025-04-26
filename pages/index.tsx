import { Box, Flex, IconButton, Text } from "@chakra-ui/react";
import { MicVAD, utils } from "@ricky0123/vad-web";
import { Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { JigsawStack } from "jigsawstack";
import Groq from "groq-sdk";

const jigsawStack = JigsawStack({
  apiKey: process.env.NEXT_PUBLIC_JIGSAWSTACK_API_KEY,
});

const groq = new Groq({ apiKey: process.env.NEXT_PUBLIC_GROQ_API_KEY, dangerouslyAllowBrowser: true });

export default function Home() {
  const [onCall, setOnCall] = useState(false);
  const [messages, setMessages] = useState<{ role: "assistant" | "user"; content: string; id: string; buffer: ArrayBuffer }[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioSpeaker = useRef<HTMLAudioElement>(null);
  const vad = useRef<MicVAD>(null);

  useEffect(() => {
    audioSpeaker.current = new Audio();
  }, []);

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
      minSpeechFrames: 5,
      model: "v5",
      positiveSpeechThreshold: 0.8,
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

  const transcribeAudio = async (buffer: ArrayBuffer) => {
    const response = await groq.audio.transcriptions.create({
      file: new File([buffer], "audio.wav", { type: "audio/wav" }),
      model: "whisper-large-v3-turbo",
    });
    return response.text;
  };

  useEffect(() => {
    const atLeastOneUnresponded = messages.length > 0 && messages[messages.length - 1].role === "user";
    if (!isSpeaking && atLeastOneUnresponded) {
      respond();
    }
  }, [isSpeaking]);

  const respond = async () => {
    const lastID = messages[messages.length - 1].id;
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You're the police operator for the 911 system. You're responsible for taking calls from the public and managing the situation. Your goal is to help the caller, decide to dispatch the police or not. You have to try your best to calm the caller down and get them to tell you what's going on. Get as much information as possible from the caller, and then decide if you need to dispatch the police or not. Make sure to stay on the line with the caller until the police arrive. Get as much info as possible from the caller. Ask one question at a time, only respond with short quick responses that's fast to speak out. Max 2 sentences at a time.",
        },
        ...messages.map((message) => ({ role: message.role, content: message.content })),
      ],
    });

    if (messages[messages.length - 1].id !== lastID) {
      return;
    }

    const responseText = response.choices[0].message.content!;

    const audio = await jigsawStack.audio.text_to_speech({
      text: responseText,
      accent: "en-AU-female-5",
    });

    if (messages[messages.length - 1].id !== lastID) {
      return;
    }

    const blob = await audio.blob();
    const arrayBuffer = await blob.arrayBuffer();

    if (messages[messages.length - 1].id !== lastID) {
      return;
    }

    if (!audioSpeaker.current) {
      return;
    }

    audioSpeaker.current.pause();
    audioSpeaker.current.src = URL.createObjectURL(new Blob([arrayBuffer], { type: "audio/wav" }));
    audioSpeaker.current.currentTime = 0;
    audioSpeaker.current.play();

    setMessages((prev) => [...prev, { role: "assistant", content: responseText, id: crypto.randomUUID(), buffer: arrayBuffer }]);
  };

  return (
    <Flex minH={"100vh"} justifyContent={"center"} alignItems={"center"} flexDir={"column"}>
      <IconButton size={"2xl"} color={onCall ? "tomato" : "green"} onClick={onCall ? handleEndCall : handleCall}>
        <Phone />
      </IconButton>
      {isSpeaking && <Text>Speaking</Text>}
      <Flex flexDir={"column"} gap={2} w={"xl"} h={"sm"} overflow={"auto"}>
        {[...messages].reverse().map((message, index) => (
          <Flex flexDir={"column"} gap={2}>
            <Text fontSize={"sm"}>{message.role}</Text>
            <Flex key={message.id} gap={2}>
              <Box asChild>
                <audio src={URL.createObjectURL(new Blob([message.buffer], { type: "audio/wav" }))} controls />
              </Box>
              <Text fontSize={"xs"} maxW={"3xs"}>
                {message.content}
              </Text>
            </Flex>
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
}
