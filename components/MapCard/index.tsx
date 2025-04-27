import { Box, Flex, type FlexProps } from "@chakra-ui/react";

interface IProps extends FlexProps {
  latitude: number | string;
  longitude: number | string;
  zoom?: number;
  height?: number;
}

const MapCard: React.FC<IProps> = ({ latitude, longitude, zoom = 11, height = 18, ...flexProps }) => {
  return (
    <Flex
      justifyContent={"center"}
      alignItems={"center"}
      pos={"relative"}
      w={"100%"}
      borderRadius={"md"}
      overflow={"hidden"}
      pointerEvents={"none"}
      {...flexProps}
      h={`${height}rem`}
    >
      <Box asChild width={"100%"} height={"35rem"} h={`${height + 14}rem`} border={0} draggable={false}>
        <iframe
          src={`https://www.google.com/maps/embed/v1/view?key=AIzaSyB35ujXdG9_d8_GiiCiCkFG5xL00VttP7Q&center=${latitude},${longitude}&zoom=${zoom}`}
          loading={"lazy"}
          allowFullScreen={false}
          referrerPolicy={"no-referrer-when-downgrade"}
        />
      </Box>
    </Flex>
  );
};

export default MapCard;
