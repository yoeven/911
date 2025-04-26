import { Flex, Icon, IconButton } from "@chakra-ui/react";
import { Phone } from "lucide-react";

export default function Home() {
  const handleCall = () => {
    console.log("calling");
  };

  return (
    <Flex minH={"100vh"} justifyContent={"center"} alignItems={"center"}>
      <IconButton size={"2xl"} color="tomato" onClick={handleCall}>
        <Phone />
      </IconButton>
    </Flex>
  );
}
