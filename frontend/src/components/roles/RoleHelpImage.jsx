import React, { useState } from "react";

export function RoleHelpImage({ src, alt, width, height }) {
  const [failed, setFailed] = useState(false);
  const ready = Boolean(src) && Number(width) > 0 && Number(height) > 0 && !failed;
  if (!ready) {
    return (
      <div
        className="role-help-shot"
        data-testid="role-help-image-placeholder"
        role="img"
        aria-label={alt || "Ekran görüntüsü yer tutucu"}
      >
        <span>Ekran görüntüsü yer tutucu</span>
        {alt ? <span className="role-help-shot-alt">{alt}</span> : null}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className="role-help-img"
      data-testid="role-help-image"
      onError={() => setFailed(true)}
    />
  );
}
