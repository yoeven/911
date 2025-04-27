import { Flex } from "@chakra-ui/react";
import { memo, useEffect, useState } from "react";
import { Visualizer } from "react-sound-visualizer";

const AudioVisualizer = () => {
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      setAudioStream(stream);
    });
  }, []);

  return (
    <Flex>
      <Visualizer audio={audioStream} autoStart>
        {({ canvasRef }) => <canvas ref={canvasRef} width={600} height={200} />}
      </Visualizer>
    </Flex>
  );
};

export default memo(AudioVisualizer);
