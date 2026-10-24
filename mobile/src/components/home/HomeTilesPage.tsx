import React from "react";
import { View } from "react-native";
import { ActionTiles, type ActionTile } from "../ActionTiles";
import { ErrorBanner } from "../kit";
import { HomeTilesEditor } from "./HomeTilesEditor";

/** Sayfa 2: karo ızgarası. Düzenle modu yalnız bu sayfada. */
export function HomeTilesPage({
  error,
  quickItems,
  showRefresh,
  refreshing,
  onRefresh,
  editing = false,
  onMoveTile,
  onDoneEdit,
  onResetEdit,
  resetDisabled = false,
}: {
  error: string | null;
  quickItems: ActionTile[];
  showRefresh: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  editing?: boolean;
  onMoveTile?: (fromIndex: number, toIndex: number) => void;
  onDoneEdit?: () => void;
  onResetEdit?: () => void;
  resetDisabled?: boolean;
}) {
  if (editing) {
    return (
      <>
        <ErrorBanner message={error} />
        <HomeTilesEditor
          items={quickItems}
          onMove={(from, to) => onMoveTile?.(from, to)}
          onDone={() => onDoneEdit?.()}
          onReset={() => onResetEdit?.()}
          resetDisabled={resetDisabled}
        />
      </>
    );
  }
  return (
    <>
      <ErrorBanner message={error} />

      <View testID="home-quick-menu">
        <ActionTiles
          size="md"
          items={[
            ...quickItems,
            ...(showRefresh ? [{
              key: "refresh",
              label: "Yenile",
              icon: "refresh" as const,
              tone: "slate" as const,
              testID: "home-quick-refresh",
              onPress: onRefresh,
              busy: refreshing,
            }] : []),
          ]}
        />
      </View>
    </>
  );
}
