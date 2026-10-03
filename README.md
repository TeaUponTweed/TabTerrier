# TabTerrier

A Firefox extension designed to help you stay focused while browsing.

## Features

- **Site blocking.** Block sites that you go to by default (looking at you news.ycombinator.com)
- **Tab limit.** Configurable tab limit. Recommend about 12.
- **Everything is pausable** Sometimes you need more tabs or to visit hacker news. TabTerrier can be paused so you can do what you need to without disabling the extension.
- **Syncs with your Firefox account** Blocklist and tab limit sync across Firefox profiles.

## Privacy

TabTerrier collects no data. Everything is stored in Firefox's own extension storage.

## Development

The toolchain runs in Docker via `tools/webext`, so nothing npm-related is installed on the host:

```sh
tools/webext lint
tools/webext build
tools/webext sign --channel=listed   # needs AMO_JWT_ISSUER / AMO_JWT_SECRET
```

## License

[MPL-2.0](LICENSE)
