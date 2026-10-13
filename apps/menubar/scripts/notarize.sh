# Sourced by build_app.sh and make_dmg.sh. notarize FILE submits FILE to Apple's notary service
# with the keychain profile $NOTARY_PROFILE and waits for the verdict. The network to Apple drops
# now and then: a failed upload is retried, and a dropped wait waits again on the same submission.
notarize() {
    local file="$1" log id="" status=""
    for _ in 1 2 3; do
        log="$(xcrun notarytool submit "$file" --keychain-profile "$NOTARY_PROFILE" --wait 2>&1)" || true
        echo "$log"
        grep -q "status: Accepted" <<<"$log" && return 0
        grep -q "status: Invalid\|status: Rejected" <<<"$log" && { echo "Rejected. Inspect it with: xcrun notarytool log <submission-id> --keychain-profile $NOTARY_PROFILE" >&2; return 1; }
        id="$(awk '/^  id: /{print $2; exit}' <<<"$log")"
        [[ -n "$id" ]] && break
        sleep 10
    done
    [[ -n "$id" ]] || { echo "Could not submit $file for notarization." >&2; return 1; }
    for _ in 1 2 3 4 5 6; do
        sleep 10
        log="$(xcrun notarytool wait "$id" --keychain-profile "$NOTARY_PROFILE" 2>&1)" || true
        echo "$log"
        status="$(awk '/status:/{print $2}' <<<"$log" | tail -1)"
        [[ "$status" == "Accepted" ]] && return 0
        [[ "$status" == "Invalid" || "$status" == "Rejected" ]] && return 1
    done
    echo "Notarization of $file did not finish: xcrun notarytool info $id --keychain-profile $NOTARY_PROFILE" >&2
    return 1
}

# staple FILE, again when the network drops.
staple() {
    for _ in 1 2 3 4; do
        xcrun stapler staple "$1" && return 0
        sleep 10
    done
    return 1
}
