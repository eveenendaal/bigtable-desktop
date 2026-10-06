cask "bigtable-desktop" do
  arch arm: "arm64", intel: "x64"

  version "0.2.0"
  sha256 arm:   "c7525b1c009b17799770286ef424e8055d952c7c8462ddcea5777f882f02712b",
         intel: "520f8b5543e05fe971f1c1483e343abe18aff255b037723dc4c4f7c537f919d8"

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
