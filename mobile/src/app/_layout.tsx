import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { colors } from "@/theme";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

function AuthRedirect() {
  const { ready, user } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === "login";
    if (!user && !onLogin) router.replace("/login");
    else if (user && onLogin) router.replace("/");
  }, [ready, user, segments, router]);

  return null;
}

function RootStack() {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return (
    <>
      <AuthRedirect />
      <Stack initialRouteName={user ? "(tabs)" : "login"} screenOptions={{ headerTitleStyle: { fontWeight: "800" }, headerBackTitle: "Geri" }}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ title: "Ara" }} />
        <Stack.Screen name="notifications" options={{ title: "Bildirimler" }} />
        <Stack.Screen name="contacts/index" options={{ title: "Cariler" }} />
        <Stack.Screen name="contacts/[id]" options={{ title: "Cari" }} />
        <Stack.Screen name="invoices/index" options={{ title: "Faturalar" }} />
        <Stack.Screen name="invoices/[id]" options={{ title: "Fatura" }} />
        <Stack.Screen name="orders/index" options={{ title: "Siparişler" }} />
        <Stack.Screen name="orders/[id]" options={{ title: "Sipariş" }} />
        <Stack.Screen name="settings" options={{ title: "Ayarlar" }} />
      </Stack>
    </>
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
