#!/usr/bin/env python3
"""Print the current TOTP code for a base32 secret (development helper).

Usage: python backend/tools/totp.py <SECRET>
Lets a developer sign in as a seeded MFA account without a phone app.
"""
import sys
import pyotp

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    print(pyotp.TOTP(sys.argv[1]).now())
