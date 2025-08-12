import { Tooltip } from "@radix-ui/themes";
import clsx from "clsx";
import { useState } from "react";
import { LuCopy } from "react-icons/lu";

export const CopyButton = ({
  children,
  text,
  label = "Copied",
  size,
  className,
}: {
  children?: React.ReactNode;
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
        className={clsx("flex items-center gap-1", className)}
      >
        {children ?? <LuCopy size={size} className="inline-block" />}
      </button>
    </Tooltip>
  );
};
