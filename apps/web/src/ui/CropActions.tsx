import { useTranslation } from "react-i18next";
import { cropInvalid } from "../model/document-ui";
import { cancelCrop, commitCrop } from "../state/session";
import { useWorkspace } from "../state/store";
import { Button } from "./widgets";

export function CropActions() {
  const { t } = useTranslation();
  const crop = useWorkspace(state => state.crop);
  if (!crop) return null;
  return <div className="crop-actions">
    <Button action="crop-cancel" onClick={cancelCrop}>{t("crop.cancel")}</Button>
    <Button action="crop-done" variant="primary" disabledReason={cropInvalid(crop.crop) ? t("crop.invalid") : undefined}
      onClick={() => void commitCrop()}>{t("crop.done")}</Button>
  </div>;
}
