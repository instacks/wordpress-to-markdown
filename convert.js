console.log('*******************************************')
console.log('* WordPress to MarkDown Converter - Start *')
console.log('*******************************************')

const http = require('https')
//const http = require('http')
const fs = require('fs')
const moment = require('moment')
const slugify = require('slugify')
// local turndown.cjs.js for white space bug fix
const turndown = require('./turndown.cjs')
const turndownPluginGfm = require('turndown-plugin-gfm')
const xml2js = require('xml2js')
const yaml = require('js-yaml')

const parser = new xml2js.Parser()

const turndownService = new turndown({})
turndownService.use(turndownPluginGfm.gfm)

var argv = require('minimist')(process.argv.slice(2));
let exportFile
if (argv.f) {
    exportFile = argv.f
} else {
    exportFile = 'export.xml'
}
if (!fs.existsSync(exportFile)) {
    console.log('Export File not available')
    process.exit(1)
}

const imagePattern = new RegExp("(?:src=\"(.*?)\")", "gi")
const exportFolderRoot = 'wordpress/'

const sleep = (milliseconds) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function processExport() {
    fs.readFile(exportFile, function (err, data) {
        if (err) {
            console.log('Error: ' + err)
        }

        parser.parseString(data, function (err, result) {
            if (err) {
                console.log('Error parsing xml: ' + err)
            }
            console.log('Parsed XML')

            let items = result.rss.channel[0].item

            if (!fs.existsSync(exportFolderRoot)) {
                fs.mkdirSync(exportFolderRoot);
            }
            if (!fs.existsSync(exportFolderRoot + 'page/')) {
                fs.mkdirSync(exportFolderRoot + 'page/');
            }
            if (!fs.existsSync(exportFolderRoot + 'post/')) {
                fs.mkdirSync(exportFolderRoot + 'post/');
            }
            if (!fs.existsSync(exportFolderRoot + 'post/' + 'media/')) {
                fs.mkdirSync(exportFolderRoot + 'post/' + 'media/');
            }

            for (let i = 0; i < items.length; i++) {
                processItems(items[i])
            }

            /*
             * TODO:
             * - Filter for published posts
             * - Add attachement URLs to header image
             */
            let highestId = 0
            for (let i = 0; i < items.length; i++) {
                if (items[i].id > highestId) {
                    highestId = items[i].id
                }
            }

            let tempItems = new Array(highestId + 1)

            for (let i = 0; i < tempItems.length; i++) {
                for (let j = 0; j < items.length; j++) {
                    if (items[j].id === i) {
                        tempItems[i] = items[j]
                        continue
                    }
                }
            }

            items = tempItems

            for (let i = 0; i < items.length; i++) {
                if (items[i] && items[i]['wp:post_type'][0] == 'post') {
                    if (items[i]['wp:postmeta']) {
                        for (let j = 0; j < items[i]['wp:postmeta'].length; j++){
                            if (items[i]['wp:postmeta'][j]['wp:meta_key'][0] == '_thumbnail_id') {
                                let thumbnailId = parseInt(items[i]['wp:postmeta'][j]['wp:meta_value'][0])
                                items[i].headerData['header_image'] = {
                                    'src' : items[thumbnailId].attachment_url,
                                    'alt' : items[thumbnailId].title
                                }
                                items[i].headerData['header_image_details'] = true
                                items[i].headerData['metadata_image'] = {
                                    'src' : items[thumbnailId].attachment_url
                                }
                            }
                        } 
                    }
                }
            }

            for (let i = 0; i < items.length; i++) {
                if (items[i] && (items[i]['wp:post_type'][0] == 'page' || items[i]['wp:post_type'][0]  == 'post')) {
                    exportItems(items[i])
                }
            }

        })
    })
}

function processItems(post) {
    post.headerData = {}
    post.headerData.id = parseInt(post['wp:post_id'][0])
    post.id = post.headerData.id
    post.headerData.title = post.title[0]
    post.title = post.headerData.title
    console.log('Processing Item ' + post.id + ' ' + post.title);

    post.headerData.date = new Date(post.pubDate)
    post.headerData.slug = post['wp:post_name'][0]
    if (!post.headerData.slug) {
        post.headerData.slug = slugify(post.headerData.title)
    }
    post.postData = post['content:encoded'][0]
    post.headerData.length = post.postData.length + ' bytes'
    post.headerData.status = post['wp:status'][0]
    post.headerData.draft = post.headerData.status == 'draft' ? true : false

    post.fileNamePrefix = moment(post.headerData.date).format('YYYY-MM-DD') + '_' + post.headerData.id + '_'
    post.fileName = post.fileNamePrefix + post.headerData.slug + '.md'

    if (post.category) {
        post.headerData.categories = []
        for (let i = 0; i < post.category.length; i++) {
            let category = post.category[i]['_']
            if (category != "Uncategorized") {
                post.headerData.categories.push(category)
            }
        }
    }

    //inline images
    let m
    let matches = []
    while ((m = imagePattern.exec(post.postData)) !== null) {
        matches.push(m[1])
    }
    if (matches != null && matches.length > 0) {
        for (let i = 0; i < matches.length; i++) {
            let url = matches[i]
            let urlParts = matches[i].split('/')
            let imageName = post.fileNamePrefix + urlParts[urlParts.length - 1]
            let filePath = exportFolderRoot + 'post/' + 'media/' + imageName

            downloadFile(url, filePath)

            //Make the image name local relative in the markdown
            //post.postData = post.postData.replace(url, 'media/' + imageName)
            let regex = new RegExp(url, 'g')
            post.postData = post.postData.replace(regex, 'media/' + imageName)
            //var res = str.replace(/blue/g, "red");
        }
    }

    //Header images
    if (post['wp:attachment_url']) {
        let url = post['wp:attachment_url'][0];
        let urlParts = url.split('/')
        let imageName = post.fileNamePrefix + urlParts[urlParts.length - 1]
        let filePath = exportFolderRoot + 'post/' + 'media/' + imageName

        downloadFile(url, filePath)

        //Make the image name local relative in the markdown
        post.attachment_url = 'media/' + imageName
    }

}

function exportItems(post) {
    console.log('Exporting Item ' + post.id + ' ' + post.title);

    let markdown = turndownService.turndown(post.postData)

    //Fix characters that markdown doesn't like
    // smart single quotes and apostrophe
    markdown = markdown.replace(/[\u2018|\u2019|\u201A]/g, "\'")
    // smart double quotes
    markdown = markdown.replace(/&quot/g, "\"")
    markdown = markdown.replace(/[\u201C|\u201D|\u201E]/g, "\"")
    // ellipsis
    markdown = markdown.replace(/\u2026/g, "...")
    // dashes
    markdown = markdown.replace(/[\u2013|\u2014]/g, "-")
    // circumflex
    markdown = markdown.replace(/\u02C6/g, "^")
    // open angle bracket
    markdown = markdown.replace(/\u2039/g, "<")
    markdown = markdown.replace(/&lt/g, "<")
    // close angle bracket
    markdown = markdown.replace(/\u203A/g, ">")
    markdown = markdown.replace(/&gt/g, ">")
    // spaces
    markdown = markdown.replace(/[\u02DC|\u00A0]/g, " ")
    // ampersand
    markdown = markdown.replace(/&amp/g, "&")

    let header = ""
    header += "---\n"
    header += yaml.safeDump(post.headerData)
    //if (categories.length > 0)
    //	header += "tags: " + JSON.stringify(categories) + '\n'
    // if (categories.length > 0) {
    //     header += "tags: " + '\n'
    //     for (let i = 0; i < categories.length; i++) {
    //         header += "  - " + categories[i] + '\n'
    //     }
    // }

    header += "---\n"

    fs.writeFile(exportFolderRoot + post['wp:post_type'][0] + '/' + post.fileName, header + markdown, function (err) {})
}

function downloadFile(url, path) {
    if (path.indexOf("?") >= 0) {
        path = path.substring(0, path.indexOf("?"))
    }
    let urlLowerCase = url.toLowerCase()
    if (urlLowerCase.indexOf(".jpg") >= 0 || urlLowerCase.indexOf(".jpeg") >= 0 || urlLowerCase.indexOf(".png") >= 0 || urlLowerCase.indexOf(".gif") >= 0) {
        let file = fs.createWriteStream(path).on('open', function () {
            console.log('Downloading url: ' + url + ' to ' + path)
            sleep(1000).then(() => {
                let request = http.get(url, function (response) {
                    response.pipe(file)
                }).on('error', function (err) {
                    console.log('Error downloading url: ' + url + ' to ' + path)
                })
            })
        }).on('error', function (err) {
            console.log('Error downloading url: ' + url + ' to ' + path)
        })
    } else {
        console.log('Passing on: ' + url)
    }
}

processExport()

// Old convert.js stop

//let markdown = turndownService.turndown('<strong>Hello world!</strong>')
//console.log(markdown)

// console.log('*******************************************')
// console.log('* WordPress to MarkDown Converter - Stop  *')
// console.log('*******************************************')
