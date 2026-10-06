cask "bigtable-desktop" do
  arch arm: "arm64", intel: "x64"

  version "0.1.1"
  sha256 arm:   "1241bf371dc5f1ba45b60ff59a99ac7fe1f67b477d9e13ef559c89e597ac5efd",
         intel: "d90b3ef900b6eb3466c481de92f03d5126c9dac44a1ee6c3ed17867ec0b69e18"

  url "https://github.com/eveenendaal/bigtable-desktop/releases/download/v#{version}/bigtable-desktop-#{version}-#{arch}.dmg"
  name "Bigtable Desktop"
  desc "Desktop client for querying and browsing Google Cloud Bigtable"
  homepage "https://github.com/eveenendaal/bigtable-desktop"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :monterey

  app "Bigtable Desktop.app"

  # The app is ad-hoc signed, not notarized. Clear the quarantine flag so
  # Gatekeeper does not refuse to open it.
  postflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/Bigtable Desktop.app"]
  end

  # Quits the app during `brew upgrade`; Homebrew reopens it once the new version is installed.
  uninstall quit: "com.eveenendaal.bigtable-desktop"

  zap trash: [
    "~/Library/Application Support/Bigtable Desktop",
    "~/Library/Logs/Bigtable Desktop",
    "~/Library/Preferences/com.eveenendaal.bigtable-desktop.plist",
    "~/Library/Saved Application State/com.eveenendaal.bigtable-desktop.savedState",
  ]
end
