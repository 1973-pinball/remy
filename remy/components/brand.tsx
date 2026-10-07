import Image from "next/image";
import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Remy Mux home">
      <Image className="brand-mark" src="/remy-logo.png" width={32} height={37} alt="" unoptimized />
      <span className="brand-name">Remy Mux<span className="brand-period">.</span></span>
    </Link>
  );
}
