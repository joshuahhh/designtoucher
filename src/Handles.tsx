import clsx from "clsx";

// Shared handle styling utility
export const getHandleClasses = (isVideo: boolean = false) => {
  const baseClasses = clsx(
    "nodrag rounded-sm transition-all duration-100",
    // React Flow's built-in handle selection styling
    "[&.clickconnecting]:border-blue-400",
    "[&.clickconnecting]:shadow-lg",
    "[&.clickconnecting]:shadow-blue-200/20",
    "[&.clickconnecting]:ring-1",
    "[&.clickconnecting]:ring-blue-300/15",
    "pointer-events-auto",
    "[&.connectionindicator]:cursor-crosshair",
    // react-flow wants events on handles to be directly on the
    // handle, not on children, so I guess this makes that work?
    "[&>*]:pointer-events-none",
  );

  if (isVideo) {
    // Large video output handle
    return clsx(
      baseClasses,
      "w-[200px] border-4 border-black hover:border-blue-300",
    );
  } else {
    // Small sentence handle
    return clsx(
      baseClasses,
      "inline-block border-2 border-solid border-black hover:border-blue-300",
    );
  }
};
