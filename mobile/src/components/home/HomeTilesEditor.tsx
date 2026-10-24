import React, { useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { colors } from "../../theme";
import { QUICK_ORDER_COLUMNS, tileDropIndex } from "../../utils/homeQuickOrder";
import { TILE_SIZES } from "../../utils/tileSizes";
import { ActionTiles, type ActionTile } from "../ActionTiles";

const CELL_HEIGHT = TILE_SIZES.md.height + 8;

/**
 * Sayfa 2 düzenle modu. Karolar basılı tutup sürüklenir.
 * Soluk karo gizli kayıttadır; dokununca tekrar görünür.
 */
export function HomeTilesEditor({
  items,
  onMove,
  onDone,
  onReset,
  resetDisabled,
}: {
  items: ActionTile[];
  onMove: (fromIndex: number, toIndex: number) => void;
  onDone: () => void;
  onReset: () => void;
  resetDisabled: boolean;
}) {
  const [gridWidth, setGridWidth] = useState(0);
  const cellWidth = gridWidth > 0 ? gridWidth / QUICK_ORDER_COLUMNS : 0;
  return (
    <View testID="home-tiles-editor" style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Pressable
          testID="home-tiles-editor-reset"
          disabled={resetDisabled}
          accessibilityLabel="Düzeni sıfırla"
          accessibilityState={{ disabled: resetDisabled }}
          onPress={() => { if (!resetDisabled) onReset(); }}
          style={{ minHeight: 36, justifyContent: "center", opacity: resetDisabled ? 0.45 : 1 }}
        >
          <Text style={{ color: resetDisabled ? colors.muted : colors.primary, fontWeight: "700", fontSize: 14 }}>
            Düzeni sıfırla
          </Text>
        </Pressable>
        <Pressable
          testID="home-tiles-editor-done"
          onPress={onDone}
          accessibilityLabel="Bitti"
          hitSlop={8}
          style={{
            minHeight: 36,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: colors.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>Bitti</Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 16 }}>
        Basılı tutup sürükleyin. Soluk kutular gizli; dokununca yeniden görünür.
      </Text>
      <View
        testID="home-tiles-editor-grid"
        onLayout={(e) => {
          const next = Math.round(e.nativeEvent.layout.width);
          setGridWidth((prev) => (prev === next ? prev : next));
        }}
        style={{ flexDirection: "row", flexWrap: "wrap" }}
      >
        {items.map((item, index) => (
          <DragSlot
            key={item.key}
            testID={`home-tiles-editor-slot-${item.key}`}
            index={index}
            count={items.length}
            cellWidth={cellWidth}
            cellHeight={CELL_HEIGHT}
            dimmed={Boolean(item.dimmed)}
            onMove={onMove}
          >
            <ActionTiles
              columns={1}
              size="md"
              embedded
              items={[{ ...item, onPress: () => {}, onLongPress: undefined }]}
            />
            {item.dimmed ? (
              <Pressable
                testID={`home-tiles-show-${item.key}`}
                accessibilityLabel={`${item.label} tekrar göster`}
                onPress={item.onPress}
                hitSlop={6}
                style={{ position: "absolute", left: 4, right: 4, bottom: 6, alignItems: "center" }}
              >
                <Text style={{ color: colors.primary, fontSize: 10, fontWeight: "800" }}>Göster</Text>
              </Pressable>
            ) : null}
          </DragSlot>
        ))}
      </View>
    </View>
  );
}

function DragSlot({
  testID,
  index,
  count,
  cellWidth,
  cellHeight,
  dimmed,
  onMove,
  children,
}: {
  testID: string;
  index: number;
  count: number;
  cellWidth: number;
  cellHeight: number;
  dimmed: boolean;
  onMove: (fromIndex: number, toIndex: number) => void;
  children: React.ReactNode;
}) {
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const cellWRef = useRef(cellWidth);
  const cellHRef = useRef(cellHeight);
  const onMoveRef = useRef(onMove);
  indexRef.current = index;
  countRef.current = count;
  cellWRef.current = cellWidth;
  cellHRef.current = cellHeight;
  onMoveRef.current = onMove;
  const grantIndex = useRef(index);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.hypot(g.dx, g.dy) > 6,
      onMoveShouldSetPanResponderCapture: (_, g) => Math.hypot(g.dx, g.dy) > 8,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        grantIndex.current = indexRef.current;
        setDrag({ x: 0, y: 0 });
      },
      onPanResponderMove: (_, g) => {
        setDrag({ x: g.dx, y: g.dy });
      },
      onPanResponderRelease: (_, g) => {
        const from = grantIndex.current;
        const to = tileDropIndex({
          fromIndex: from,
          dx: g.dx,
          dy: g.dy,
          cellWidth: cellWRef.current,
          cellHeight: cellHRef.current,
          columns: QUICK_ORDER_COLUMNS,
          count: countRef.current,
        });
        setDrag(null);
        if (to !== from) onMoveRef.current(from, to);
      },
      onPanResponderTerminate: () => {
        setDrag(null);
      },
    }),
  ).current;

  return (
    <View
      testID={testID}
      {...responder.panHandlers}
      style={{
        width: `${100 / QUICK_ORDER_COLUMNS}%`,
        zIndex: drag ? 8 : 1,
        opacity: dimmed ? 0.4 : 1,
        transform: drag ? [{ translateX: drag.x }, { translateY: drag.y }] : undefined,
      }}
    >
      {children}
    </View>
  );
}
