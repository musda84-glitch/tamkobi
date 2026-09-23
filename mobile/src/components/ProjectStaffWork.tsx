import { Image } from "expo-image";
import React from "react";
import { Linking, Pressable, Text, View, type ViewStyle } from "react-native";
import { fileUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import { photoVisibilityLabel } from "../utils/assignedDuty";
import {
  PROJECT_STAFF_WORK_EMPTY,
  PROJECT_STAFF_WORK_TITLE,
  projectStaffWork,
  type ProjectDoc,
} from "../utils/workDocs";
import { Badge, Card, Muted, Row } from "./kit";

export function ProjectStaffWorkCard({
  project,
  style,
  testID = "project-staff-work",
}: {
  project: ProjectDoc;
  style?: ViewStyle;
  testID?: string;
}) {
  const { client } = useAuth();
  const people = projectStaffWork(project.tasks, project.stage_photos);
  return (
    <Card testID={testID} style={style}>
      <Text style={{ fontWeight: "800", color: colors.text }}>{PROJECT_STAFF_WORK_TITLE}</Text>
      <Muted>Görevli personelin yaptığı işler ve yüklediği fotoğraflar</Muted>
      {!people.length ? <Muted testID={`${testID}-empty`}>{PROJECT_STAFF_WORK_EMPTY}</Muted> : null}
      {people.map((person) => (
        <View
          key={person.key}
          testID={`${testID}-person-${person.key}`}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, gap: 6, backgroundColor: colors.slate50 }}
        >
          <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontWeight: "800", color: colors.text }}>{person.name}</Text>
              <Muted>{person.label}</Muted>
            </View>
            <Badge label={person.done === person.total && person.total ? "Tamam" : "Açık"} tone={person.done === person.total && person.total ? "green" : "indigo"} />
          </Row>
          {person.tasks.map((task) => (
            <View key={task.id || task.title} testID={`${testID}-task-${task.id}`} style={{ gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: task.done ? colors.primaryHover : colors.text }}>
                {task.done ? "✓" : "○"} {task.title}
                {task.due_date ? ` · ${task.due_date}` : ""}
              </Text>
              {task.photos.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {task.photos.map((p) => (
                    <Pressable
                      key={p.url}
                      testID={`${testID}-photo`}
                      onPress={() => Linking.openURL(fileUrl(client.baseUrl, p.url)).catch(() => null)}
                    >
                      <Image
                        source={{ uri: fileUrl(client.baseUrl, p.url) }}
                        style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: colors.slate100 }}
                        contentFit="cover"
                      />
                      <Text style={{ fontSize: 9, fontWeight: "700", color: colors.muted, maxWidth: 56 }} numberOfLines={1}>
                        {photoVisibilityLabel(p)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </Card>
  );
}
