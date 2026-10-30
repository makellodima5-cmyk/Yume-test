import logoArtwork from "@/assets/yume-logo.webp";

/**
 * YUME wordmark artwork: crescent moon and white serif lettering, without kanji.
 */
export function Logo() {
  return (
    <img
      src={logoArtwork}
      alt="YUME"
      width={500}
      height={200}
      className="h-auto w-[124px] shrink-0 object-contain select-none md:w-[148px]"
      draggable={false}
    />
  );
}
