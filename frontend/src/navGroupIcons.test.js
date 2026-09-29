import { labeledNavGroupsMissingIcons, iconForNavGroup, NAV_GROUP_ICONS } from "./navGroupIcons";

test("etiketli her menü paketinin ikonu var", () => {
  expect(labeledNavGroupsMissingIcons()).toEqual([]);
});

test("bilinmeyen grup varsayılan ikona düşer", () => {
  expect(iconForNavGroup("yok")).toBeTruthy();
  expect(NAV_GROUP_ICONS.muhasebe).toBeTruthy();
});
