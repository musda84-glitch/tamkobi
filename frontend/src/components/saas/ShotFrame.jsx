import React, { useState } from "react";
import { screenshotSrc } from "../../utils/modulesContent";

function Sketch({ accent, icon, slug }) {
  return (
    <div className="absolute inset-0 p-3.5" data-testid={`shot-placeholder-${slug}`}>
      <div className="flex h-full overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#0f172a]">
        <div className="flex w-[22%] flex-col gap-[5px] bg-[#0b1222] p-2">
          {Array.from({ length: 7 }, (_, i) => (
            <i
              key={i}
              className="block h-[5px] rounded-[3px] bg-[#1e293b]"
              style={i === 0 ? { background: accent } : undefined}
            />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
          <div className="flex gap-1">
            {Array.from({ length: 3 }, (_, i) => (
              <i
                key={i}
                className="block h-[22px] flex-1 rounded-[5px] bg-[#1e293b]"
                style={i === 0 ? { background: accent, opacity: 0.6 } : undefined}
              />
            ))}
          </div>
          {Array.from({ length: 6 }, (_, i) => (
            <i
              key={i}
              className="block h-[7px] rounded-[3px] bg-[#1e293b]"
              style={i % 2 === 0 ? { width: "85%" } : undefined}
            />
          ))}
        </div>
      </div>
      {icon ? (
        <div
          className="absolute right-3.5 top-3.5 flex h-[30px] w-[30px] items-center justify-center rounded-[9px] text-[15px]"
          style={{ background: accent }}
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div
        className="absolute bottom-2.5 left-2.5 rounded-md bg-yellow-400/90 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-stone-900"
        data-testid={`shot-placeholder-label-${slug}`}
      >
        Örnek görsel
      </div>
    </div>
  );
}

/** Ekran görüntüsü varsa gösterir; dosya yoksa sade arayüz çizimine düşer. */
export default function ShotFrame({ slug, accent = "#34d399", icon = "", className = "" }) {
  const [phase, setPhase] = useState("pending");
  const src = screenshotSrc(slug);
  const showSketch = phase !== "ok";
  return (
    <div
      className={`relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-[#111827] to-[#1e1b4b] ${className}`}
      data-testid={`shot-${slug}`}
    >
      {phase !== "missing" ? (
        <img
          src={src}
          alt=""
          className={phase === "ok" ? "absolute inset-0 h-full w-full object-cover" : "sr-only"}
          onLoad={() => setPhase("ok")}
          onError={() => setPhase("missing")}
          data-testid={`shot-img-${slug}`}
        />
      ) : null}
      {showSketch ? <Sketch accent={accent} icon={icon} slug={slug} /> : null}
    </div>
  );
}
