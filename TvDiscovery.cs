using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using System.Xml;
using System.Xml.Linq;

sealed class TvDevice
{
    public readonly IPAddress Address;
    readonly string name;

    public TvDevice(IPAddress address, string name)
    {
        Address = address;
        this.name = name;
    }

    public override string ToString()
    {
        return name + " (" + Address + ")";
    }
}

static class TvDiscovery
{
    const string Receiver = "urn:samsung.com:device:RemoteControlReceiver:1";
    const string TvAgent = "urn:samsung.com:service:MainTVAgent2:1";
    const string Renderer = "urn:schemas-upnp-org:service:RenderingControl:1";
    const int SearchMilliseconds = 2500;
    const int MaxCandidates = 16;
    const int MaxDescriptionSize = 64 * 1024;

    sealed class Candidate
    {
        public IPAddress Address;
        public bool SamsungTv;
        public Uri Description;
    }

    public static async Task<TvDevice[]> FindAsync(IPEndPoint destination = null)
    {
        var endpoint = destination ?? new IPEndPoint(IPAddress.Parse("239.255.255.250"), 1900);
        var candidates = await Task.Run(() => Search(endpoint)).ConfigureAwait(false);
        using (var handler = new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false })
        using (var http = new HttpClient(handler))
        {
            http.Timeout = TimeSpan.FromMilliseconds(1500);
            http.MaxResponseContentBufferSize = MaxDescriptionSize;
            var devices = await Task.WhenAll(candidates.Select(candidate => IdentifyAsync(http, candidate))).ConfigureAwait(false);
            return devices.Where(device => device != null).OrderBy(device => device.ToString()).ToArray();
        }
    }

    static ICollection<Candidate> Search(IPEndPoint destination)
    {
        var candidates = new Dictionary<IPAddress, Candidate>();
        using (var udp = new UdpClient(AddressFamily.InterNetwork))
        {
            udp.Client.Bind(new IPEndPoint(IPAddress.Any, 0));
            foreach (string target in new[] { Receiver, TvAgent, Renderer })
            {
                var request = Encoding.ASCII.GetBytes(
                    "M-SEARCH * HTTP/1.1\r\nHOST: " + destination +
                    "\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + target + "\r\n\r\n");
                udp.Send(request, request.Length, destination);
            }

            var clock = Stopwatch.StartNew();
            var sender = new IPEndPoint(IPAddress.Any, 0);
            int remaining;
            while ((remaining = SearchMilliseconds - (int)clock.ElapsedMilliseconds) > 0)
            {
                udp.Client.ReceiveTimeout = remaining;
                byte[] response;
                try
                {
                    response = udp.Receive(ref sender);
                }
                catch (SocketException error)
                {
                    if (error.SocketErrorCode == SocketError.TimedOut)
                        break;
                    throw;
                }

                var candidate = ParseResponse(response, sender.Address);
                if (candidate == null)
                    continue;

                Candidate current;
                if (candidates.TryGetValue(candidate.Address, out current))
                {
                    if (current.Description == null || (candidate.SamsungTv && candidate.Description != null))
                        current.Description = candidate.Description;
                    current.SamsungTv |= candidate.SamsungTv;
                }
                else if (candidates.Count < MaxCandidates)
                {
                    candidates.Add(candidate.Address, candidate);
                }
            }
        }

        return candidates.Values;
    }

    static Candidate ParseResponse(byte[] packet, IPAddress sender)
    {
        if (packet.Length > 8192)
            return null;

        string[] lines = Encoding.UTF8.GetString(packet).Split('\n');
        string[] status = lines[0].Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        if (status.Length < 2 || !status[0].StartsWith("HTTP/1.", StringComparison.OrdinalIgnoreCase) || status[1] != "200")
            return null;

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (string line in lines.Skip(1))
        {
            if (string.IsNullOrWhiteSpace(line))
                break;

            int colon = line.IndexOf(':');
            if (colon > 0)
                headers[line.Substring(0, colon).Trim()] = line.Substring(colon + 1).Trim();
        }

        string target;
        if (!headers.TryGetValue("ST", out target))
            return null;

        bool samsung = EqualsIgnoreCase(target, Receiver) || EqualsIgnoreCase(target, TvAgent);
        if (!samsung && !EqualsIgnoreCase(target, Renderer))
            return null;

        string location;
        Uri uri;
        if (!headers.TryGetValue("Location", out location) || !Uri.TryCreate(location, UriKind.Absolute, out uri) ||
            uri.Scheme != Uri.UriSchemeHttp || uri.Host != sender.ToString() || uri.UserInfo.Length != 0)
            uri = null;

        return new Candidate { Address = sender, SamsungTv = samsung, Description = uri };
    }

    static async Task<TvDevice> IdentifyAsync(HttpClient http, Candidate candidate)
    {
        string name = "";
        bool samsung = candidate.SamsungTv;
        if (candidate.Description != null)
        {
            try
            {
                byte[] description = await http.GetByteArrayAsync(candidate.Description).ConfigureAwait(false);
                using (var stream = new MemoryStream(description))
                using (var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }))
                {
                    var device = XDocument.Load(reader).Descendants().FirstOrDefault(element => element.Name.LocalName == "device");
                    if (device != null)
                    {
                        name = Value(device, "friendlyName");
                        string maker = Value(device, "manufacturer");
                        bool madeBySamsung = EqualsIgnoreCase(maker, "Samsung") || maker.StartsWith("Samsung Electronics", StringComparison.OrdinalIgnoreCase);
                        samsung |= madeBySamsung && (name.StartsWith("[TV]", StringComparison.OrdinalIgnoreCase) ||
                            Value(device, "modelDescription").IndexOf("TV", StringComparison.OrdinalIgnoreCase) >= 0);
                    }
                }
            }
            catch (HttpRequestException) { }
            catch (OperationCanceledException) { }
            catch (IOException) { }
            catch (XmlException) { }
        }

        if (!samsung)
            return null;

        name = new string(name.Where(character => !char.IsControl(character)).Take(65).ToArray());
        return new TvDevice(candidate.Address, string.IsNullOrWhiteSpace(name) ? "TV Samsung" : name);
    }

    static string Value(XElement device, string name)
    {
        var field = device.Elements().FirstOrDefault(element => element.Name.LocalName == name);
        return field == null ? "" : field.Value.Trim();
    }

    static bool EqualsIgnoreCase(string left, string right)
    {
        return string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
    }
}
