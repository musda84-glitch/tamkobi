import React from "react";
import { Badge, ListRow } from "./kit";
import { ProductThumb } from "./ProductThumb";
import { colors } from "../theme";
import type { Product } from "../types";
import { fmtMoney, idOf } from "../utils/money";
import { productImage, productPickSubtitle, stockBadge, stockRightLabel } from "../utils/productDisplay";

export function ProductPickRow({
  product,
  onPress,
  testID,
}: {
  product: Product;
  onPress: () => void;
  testID?: string;
}) {
  const id = idOf(product);
  const badge = stockBadge(product);
  const qtyTone = badge?.tone === "danger" ? "red" : badge?.tone === "warning" ? "amber" : "green";
  const photo = productImage(product);
  return (
    <ListRow
      testID={testID || `prod-pick-${id}`}
      image={photo}
      leading={<ProductThumb uri={photo} size={64} testID={`prod-pick-thumb-${id}`} />}
      title={product.name}
      subtitle={productPickSubtitle(product)}
      right={fmtMoney(product.sale_price)}
      rightSub={stockRightLabel(product)}
      rightColor={qtyTone === "red" ? colors.danger : qtyTone === "amber" ? colors.warning : colors.text}
      badge={<Badge label={badge?.label || stockRightLabel(product)} tone={qtyTone} />}
      onPress={onPress}
    />
  );
}
