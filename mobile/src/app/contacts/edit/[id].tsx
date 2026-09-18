import { ContactFormScreen } from "@/screens/ContactFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function ContactEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ContactFormScreen contactId={id} />;
}
