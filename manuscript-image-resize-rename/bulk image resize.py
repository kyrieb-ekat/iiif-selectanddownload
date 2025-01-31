from PIL import Image
import os

# Define the directory containing the images
directory = "/Users/ekaterina/downloads/MS073/MS73 test"
#test directory /Users/ekaterina/downloads/MS073/MS73 test
#actual mss image directory /Users/ekaterina/downloads/MS073/MS73 original
output_directory = "/Users/ekaterina/downloads/MS073/MS73_renamed_resized"

# Ensure the output directory exists
os.makedirs(output_directory, exist_ok=True)

# Iterate through each file in the directory
for filename in os.listdir(directory):
    file_path = os.path.join(directory, filename)
    
    # Check if the file is an image
    try:
        with Image.open(file_path) as img:
            # Calculate the new size (50% of the original)
            new_size = (img.width // 2, img.height // 2)
            # Resize the image
            resized_img = img.resize(new_size, Image.Resampling.LANCZOS)
            # Save the resized image to the output directory
            output_path = os.path.join(output_directory, filename)
            resized_img.save(output_path)
            print(f"Resized: {filename} -> {output_path}")
    except (IOError, OSError) as e:
        print(f"Skipping {filename}: {e}")

print("all done!")

#note: if the image sizes are too big you will get a decompression bomb DOS attack warning
#so if they are IIIF images, it's probably best to utilise ImageMagick (installable through homebrew)
#if the images exceed 89478485 pixels