import React from "react";
import { View } from "react-native";
import { ActionTiles, type ActionTile } from "../ActionTiles";
import { ErrorBanner } from "../kit";

/** Sayfa 2: karo ızgarası */
export function HomeTilesPage({
  error,
  quickItems,
  showRefresh,
  refreshing,
  onRefresh,
}: {
  error: string | null;
  quickItems: ActionTile[];
  showRefresh: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
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
