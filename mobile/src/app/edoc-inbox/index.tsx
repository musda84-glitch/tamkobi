import { Redirect } from "expo-router";
import { useAuth } from "@/auth/AuthContext";
import { EdocInboxScreen } from "@/screens/EdocInboxScreen";

export default function EdocInboxRoute() {
  const { can } = useAuth();
  if (!can("/edoc-inbox")) return <Redirect href="/" />;
  return <EdocInboxScreen />;
}
