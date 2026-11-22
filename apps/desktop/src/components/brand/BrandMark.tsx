type BrandMarkProps = {
  className?: string;
  variant?: "mark" | "watermark";
};

export function BrandMark({ className = "", variant = "mark" }: BrandMarkProps) {
  const variantClassName = variant === "watermark" ? "neubiki-brand-watermark" : "neubiki-brand-mark";

  return <span aria-hidden="true" className={[variantClassName, className].filter(Boolean).join(" ")} />;
}
