// Chromium shows macOS's own picker for content's kMacOsNativePickerId with a negative window id, new each request.
const MAC_NATIVE_PICKER_ID = -4
let nextWindow = -1

export const systemPickerSource = () => ({ id: `window:${MAC_NATIVE_PICKER_ID}:${nextWindow--}`, name: "" })
