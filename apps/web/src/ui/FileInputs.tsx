import { ensureEditorFonts } from "../editor-fonts";
import { importFiles, importPackage } from "../state/session";
import { useNavigation } from "../navigation";
import { errorText } from "../model/feedback";

export function FileInputs() {
  const run = (task: () => Promise<void>) => void ensureEditorFonts().then(task).catch(error => useNavigation.setState({ notice: errorText(error) }));
  return <>
    <input id="import-input" data-testid="import-input" className="hidden-input" type="file" multiple
      accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg" aria-hidden="true" tabIndex={-1}
      onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ""; run(() => importFiles(files)); }} />
    <input id="package-input" className="hidden-input" type="file" accept=".figurezip,application/zip" aria-hidden="true" tabIndex={-1}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) run(() => importPackage(file)); }} />
  </>;
}
