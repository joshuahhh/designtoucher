import { Tooltip } from "@radix-ui/themes";
import { useState } from "react";
import { LuCopy } from "react-icons/lu";

export const CopyButton = ({
  text,
  label = "Copied",
  size,
  className,
}: {
  text: string;
  label?: string;
  size?: number;
  className?: string;
}) => {
  const [isCopyTooltipOpen, setIsCopyTooltipOpen] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText(text);

    setIsCopyTooltipOpen(true);

    setTimeout(() => {
      setIsCopyTooltipOpen(false);
    }, 1000);
  };

  return (
    <Tooltip content={label} open={isCopyTooltipOpen}>
      <button
        onClick={onCopy}
        onBlur={() => setIsCopyTooltipOpen(false)}
        className={className}
      >
        <LuCopy size={size} />
      </button>
    </Tooltip>
  );
};
