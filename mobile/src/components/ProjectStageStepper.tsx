import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../theme";
import { normalizeProjectStages, projectStageState, type ProjectStage } from "../utils/projectStages";

const CIRCLE = 26;

export function ProjectStageStepper({
  projectId,
  status,
  stages,
  canEdit,
  statusBusy,
  onStatus,
}: {
  projectId: string;
  status?: string | null;
  stages?: ProjectStage[] | null;
  canEdit: boolean;
  statusBusy?: boolean;
  onStatus: (key: string) => void;
}) {
  const list = normalizeProjectStages(stages);
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      testID={`project-status-${projectId}`}
      contentContainerStyle={{ flexDirection: "row", alignItems: "flex-start", gap: 4, paddingVertical: 2 }}
    >
      {list.map((stage, index) => {
        const state = projectStageState(list, status, stage.key);
        const done = state === "done";
        const current = state === "current";
        const circleBg = done ? "#059669" : current ? colors.indigo : "#fff";
        const circleBorder = done ? "#059669" : current ? colors.indigo : "#CBD5E1";
        const labelColor = done ? "#047857" : current ? "#3730A3" : "#94A3B8";
        const body = (
          <View style={{ minWidth: 68, maxWidth: 88, alignItems: "center", gap: 4, paddingHorizontal: 2, paddingVertical: 2 }}>
            <View
              style={{
                width: CIRCLE,
                height: CIRCLE,
                borderRadius: CIRCLE / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: circleBg,
                borderWidth: 2,
                borderColor: circleBorder,
              }}
            >
              <Text style={{ color: done || current ? "#fff" : "#94A3B8", fontWeight: "800", fontSize: 11 }}>
                {done ? "✓" : String(index + 1)}
              </Text>
            </View>
            <Text numberOfLines={2} style={{ textAlign: "center", fontSize: 10, fontWeight: "700", color: labelColor }}>
              {stage.label}
            </Text>
          </View>
        );
        const tid = `project-status-${projectId}-${stage.key}`;
        if (!canEdit) {
          return (
            <View key={stage.key} testID={tid} accessibilityLabel={`Aşama: ${stage.label}`}>
              {body}
            </View>
          );
        }
        return (
          <Pressable
            key={stage.key}
            testID={tid}
            accessibilityLabel={`Aşama: ${stage.label}`}
            accessibilityRole="button"
            disabled={!!statusBusy}
            onPress={() => {
              if (statusBusy) return;
              onStatus(stage.key);
            }}
          >
            {body}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
