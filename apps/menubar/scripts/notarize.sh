# Sourced by build_app.sh and make_dmg.sh. notarize FILE submits FILE to Apple's notary service with
# the keychain profile $NOTARY_PROFILE and waits for the verdict. The network to Apple drops now and
# then: an upload that did not finish is submitted again (a submission whose upload failed stays
# "In Progress" forever), and a dropped wait waits again, with a timeout, on the same submission.
# with_timeout SECONDS CMD... kills CMD after SECONDS: notarytool can hang on a dead connection.
with_timeout() {
    /usr/bin/perl -e 'alarm shift; exec @ARGV' "$@"
}

notarize() {
    local file="$1" log id="" status=""
    for _ in 1 2 3 4; do
        log="$(with_timeout 1200 xcrun notarytool submit "$file" --keychain-profile "$NOTARY_PROFILE" --wait --timeout 15m 2>&1)" || true
        echo "$log"
        status="$(awk '/^  status: /{print $2}' <<<"$log" | tail -1)"
        [[ "$status" == "Accepted" ]] && return 0
        [[ "$status" == "Invalid" || "$status" == "Rejected" ]] && {
            echo "Rejected. Inspect it with: xcrun notarytool log <submission-id> --keychain-profile $NOTARY_PROFILE" >&2
            return 1
        }
        if grep -q "Successfully uploaded" <<<"$log"; then
            id="$(awk '/^  id: /{print $2; exit}' <<<"$log")"
            break
        fi
        sleep 10
    done
    [[ -n "$id" ]] || { echo "Could not upload $file for notarization." >&2; return 1; }
    for _ in 1 2 3 4 5 6; do
        sleep 10
        log="$(with_timeout 720 xcrun notarytool wait "$id" --keychain-profile "$NOTARY_PROFILE" --timeout 10m 2>&1)" || true
        echo "$log"
        status="$(awk '/^  status: /{print $2}' <<<"$log" | tail -1)"
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
