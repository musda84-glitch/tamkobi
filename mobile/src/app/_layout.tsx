import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";

function RootStack() {
  const { ready, user, b2bToken } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  const signedIn = !!user;
  const onB2b = !signedIn && !!b2bToken;
  return (
    <Stack
      screenOptions={{
        headerTitleStyle: { fontWeight: "800", color: colors.text },
        headerBackTitle: "Geri",
        headerTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.surface },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ title: "Ara" }} />
        <Stack.Screen name="notifications" options={{ title: "Bildirimler" }} />
        <Stack.Screen name="contacts/index" options={{ title: "Cariler" }} />
        <Stack.Screen name="contacts/[id]" options={{ title: "Cari" }} />
        <Stack.Screen name="invoices/index" options={{ title: "Faturalar" }} />
        <Stack.Screen name="invoices/new" options={{ title: "Yeni fatura" }} />
        <Stack.Screen name="invoices/edit/[id]" options={{ title: "Taslak düzenle" }} />
        <Stack.Screen name="invoices/[id]" options={{ title: "Fatura" }} />
        <Stack.Screen name="orders/index" options={{ title: "Siparişler" }} />
        <Stack.Screen name="orders/[id]" options={{ title: "Sipariş" }} />
        <Stack.Screen name="stock/new" options={{ title: "Yeni stok kartı" }} />
        <Stack.Screen name="stock/[id]" options={{ title: "Stok kartı" }} />
        <Stack.Screen name="settings" options={{ title: "Ayarlar" }} />
      </Stack.Protected>
      <Stack.Protected guard={onB2b}>
        <Stack.Screen name="b2b" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn && !onB2b}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <RootStack />
    </AuthProvider>
  );
}
