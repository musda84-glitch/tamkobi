import { VehicleFormScreen } from "@/screens/VehicleFormScreen";
import { useLocalSearchParams } from "expo-router";

export default function VehicleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <VehicleFormScreen vehicleId={id} />;
}
