import { Box, Text } from "ink";

const THEME_COLOR = "#3964FE";

interface HeaderProps {
  version: string;
  model: string;
  thinking: boolean;
  reasoningEffort: string;
}

const Header = ({ version, model, thinking, reasoningEffort }: HeaderProps) => {
  const infoRows = [
    { label: "Model", value: model },
    { label: "Thinking", value: thinking ? "Enabled" : "Disabled" },
    { label: "Reasoning Effort", value: reasoningEffort },
    { label: "Path", value: process.cwd() },
  ];

  return (
    <Box
      borderStyle="round"
      borderColor={THEME_COLOR}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
      flexDirection="column"
      width={60}
    >
      <Box marginBottom={1}>
        <Text color={THEME_COLOR} bold>{`>_ Tiga Code`}</Text>
        <Text dimColor>{`    (V${version})`}</Text>
      </Box>

      {infoRows.map(({ label, value }) => (
        <Box key={label} justifyContent="space-between">
          <Text>{label}</Text>
          <Text>{value}</Text>
        </Box>
      ))}
    </Box>
  );
};

export default Header;
