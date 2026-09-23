import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { BadgeProvider } from "@/auth/BadgeContext";
import { PushBridge } from "@/components/PushBridge";
import { colors } from "@/theme";
import { typeface } from "@/theme/softFont";
import { enableSoftFonts, SOFT_FONT_FACES } from "@/theme/softFontRuntime";
import { useFonts } from "expo-font";
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
        headerTitleStyle: { color: colors.text, ...typeface("800") },
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
        <Stack.Screen name="contacts/new" options={{ title: "Yeni cari" }} />
        <Stack.Screen name="contacts/edit/[id]" options={{ title: "Cariyi düzenle" }} />
        <Stack.Screen name="contacts/statement/[id]" options={{ title: "Cari ekstre" }} />
        <Stack.Screen name="contacts/[id]" options={{ title: "Cari" }} />
        <Stack.Screen name="invoices/index" options={{ title: "Faturalar" }} />
        <Stack.Screen name="invoices/new" options={{ title: "Yeni fatura" }} />
        <Stack.Screen name="invoices/edit/[id]" options={{ title: "Taslak düzenle" }} />
        <Stack.Screen name="invoices/[id]" options={{ title: "Fatura" }} />
        <Stack.Screen name="edoc-inbox/index" options={{ title: "Gelen e-Faturalar" }} />
        <Stack.Screen name="orders/index" options={{ title: "Siparişler" }} />
        <Stack.Screen name="orders/edit/[id]" options={{ title: "Siparişi düzenle" }} />
        <Stack.Screen name="sevk/index" options={{ title: "Depo Sevkiyat" }} />
        <Stack.Screen name="sevk/[id]" options={{ title: "Sipariş topla" }} />
        <Stack.Screen name="atolye/index" options={{ title: "Üretim Atölye" }} />
        <Stack.Screen name="orders/[id]" options={{ title: "Sipariş" }} />
        <Stack.Screen name="stock/new" options={{ title: "Yeni stok kartı" }} />
        <Stack.Screen name="stock/[id]" options={{ title: "Stok kartı" }} />
        <Stack.Screen name="pay/index" options={{ title: "Tahsilat & Ödeme Yap" }} />
        <Stack.Screen name="banking/index" options={{ title: "Kasa & Banka" }} />
        <Stack.Screen name="banking/new" options={{ title: "Yeni hesap" }} />
        <Stack.Screen name="banking/virman" options={{ title: "Virman" }} />
        <Stack.Screen name="banking/edit/[id]" options={{ title: "Hesabı düzenle" }} />
        <Stack.Screen name="banking/[id]" options={{ title: "Hesap" }} />
        <Stack.Screen name="installments/index" options={{ title: "Taksitler" }} />
        <Stack.Screen name="cheques/index" options={{ title: "Çek & Senet" }} />
        <Stack.Screen name="cheques/new" options={{ title: "Yeni çek / senet" }} />
        <Stack.Screen name="cheques/[id]" options={{ title: "Çek / senet" }} />
        <Stack.Screen name="expenses/index" options={{ title: "Masraflar" }} />
        <Stack.Screen name="expenses/new" options={{ title: "Yeni masraf" }} />
        <Stack.Screen name="expenses/[id]" options={{ title: "Masraf" }} />
        <Stack.Screen name="quotes/index" options={{ title: "Teklifler" }} />
        <Stack.Screen name="quotes/new" options={{ title: "Yeni teklif" }} />
        <Stack.Screen name="quotes/[id]" options={{ title: "Teklif" }} />
        <Stack.Screen name="projects/index" options={{ title: "Projeler" }} />
        <Stack.Screen name="projects/new" options={{ title: "Yeni proje" }} />
        <Stack.Screen name="projects/[id]" options={{ title: "Proje" }} />
        <Stack.Screen name="surveys/index" options={{ title: "Keşifler" }} />
        <Stack.Screen name="surveys/new" options={{ title: "Yeni keşif" }} />
        <Stack.Screen name="surveys/[id]" options={{ title: "Keşif" }} />
        <Stack.Screen name="personnel/index" options={{ title: "Personel & Bordro" }} />
        <Stack.Screen name="personnel/new" options={{ title: "Yeni personel" }} />
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
  const [fontsReady, fontError] = useFonts(SOFT_FONT_FACES);
  if (fontsReady || fontError) enableSoftFonts();
  if (!fontsReady && !fontError) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return (
    <AuthProvider>
      <BadgeProvider>
        <StatusBar style="auto" />
        <PushBridge />
        <RootStack />
      </BadgeProvider>
    </AuthProvider>
  );
}
